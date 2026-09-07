//! The RFC 6455 frame layer, written out rather than pulled in.
//!
//! A wavex host reads and writes the same socket from two threads: a command
//! thread that answers whatever the client asked for, and a stream thread that
//! pushes journal events as they are published. Every ready-made blocking
//! WebSocket in Rust owns both directions behind one handle and answers a ping
//! from inside `read`, which would interleave a pong with a half-written event
//! frame. Splitting the directions is the whole reason this file exists.

use std::io::{Read, Write};

/// A single agent line or PTY chunk is small; anything near this is a bug or
/// an attack, and reading it would be the host's memory, not the client's.
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const OP_CONTINUATION: u8 = 0x0;
const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xA;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<(u16, String)>),
}

#[derive(Debug)]
pub enum FrameError {
    Io(std::io::Error),
    /// The peer broke the framing rules, so the connection cannot continue.
    Protocol(&'static str),
}

impl From<std::io::Error> for FrameError {
    fn from(error: std::io::Error) -> Self {
        FrameError::Io(error)
    }
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::Io(error) => write!(formatter, "{error}"),
            FrameError::Protocol(reason) => write!(formatter, "{reason}"),
        }
    }
}

struct Frame {
    final_fragment: bool,
    opcode: u8,
    payload: Vec<u8>,
}

/// Reassembles fragments into whole messages. Control frames may arrive in the
/// middle of a fragmented message, so they are returned without disturbing the
/// partial payload being collected.
pub struct MessageReader<R: Read> {
    reader: R,
    partial: Option<(u8, Vec<u8>)>,
}

impl<R: Read> MessageReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            partial: None,
        }
    }

    pub fn read(&mut self) -> Result<Message, FrameError> {
        loop {
            let frame = self.read_frame()?;
            match frame.opcode {
                OP_PING => return Ok(Message::Ping(frame.payload)),
                OP_PONG => return Ok(Message::Pong(frame.payload)),
                OP_CLOSE => return Ok(Message::Close(parse_close(&frame.payload))),
                OP_TEXT | OP_BINARY => {
                    if self.partial.is_some() {
                        return Err(FrameError::Protocol("interleaved data frame"));
                    }
                    if frame.final_fragment {
                        return finish(frame.opcode, frame.payload);
                    }
                    self.partial = Some((frame.opcode, frame.payload));
                }
                OP_CONTINUATION => {
                    let Some((opcode, mut buffered)) = self.partial.take() else {
                        return Err(FrameError::Protocol("continuation without a start frame"));
                    };
                    if buffered.len() + frame.payload.len() > MAX_MESSAGE_BYTES {
                        return Err(FrameError::Protocol("message is too large"));
                    }
                    buffered.extend_from_slice(&frame.payload);
                    if frame.final_fragment {
                        return finish(opcode, buffered);
                    }
                    self.partial = Some((opcode, buffered));
                }
                _ => return Err(FrameError::Protocol("unsupported opcode")),
            }
        }
    }

    fn read_frame(&mut self) -> Result<Frame, FrameError> {
        let mut header = [0u8; 2];
        self.reader.read_exact(&mut header)?;

        if header[0] & 0x70 != 0 {
            return Err(FrameError::Protocol("reserved bits are set"));
        }
        let final_fragment = header[0] & 0x80 != 0;
        let opcode = header[0] & 0x0F;
        let masked = header[1] & 0x80 != 0;
        let length = match header[1] & 0x7F {
            126 => {
                let mut extended = [0u8; 2];
                self.reader.read_exact(&mut extended)?;
                u16::from_be_bytes(extended) as usize
            }
            127 => {
                let mut extended = [0u8; 8];
                self.reader.read_exact(&mut extended)?;
                let length = u64::from_be_bytes(extended);
                if length > MAX_MESSAGE_BYTES as u64 {
                    return Err(FrameError::Protocol("message is too large"));
                }
                length as usize
            }
            short => short as usize,
        };

        let control = opcode & 0x08 != 0;
        if control && (length > 125 || !final_fragment) {
            return Err(FrameError::Protocol("malformed control frame"));
        }
        if length > MAX_MESSAGE_BYTES {
            return Err(FrameError::Protocol("message is too large"));
        }
        // A client that does not mask is either broken or not a browser
        // pretending to be one. Either way the spec says to fail the socket.
        if !masked {
            return Err(FrameError::Protocol("client frames must be masked"));
        }

        let mut mask = [0u8; 4];
        self.reader.read_exact(&mut mask)?;
        let mut payload = vec![0u8; length];
        self.reader.read_exact(&mut payload)?;
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }

        Ok(Frame {
            final_fragment,
            opcode,
            payload,
        })
    }
}

fn finish(opcode: u8, payload: Vec<u8>) -> Result<Message, FrameError> {
    if opcode == OP_BINARY {
        return Ok(Message::Binary(payload));
    }
    String::from_utf8(payload)
        .map(Message::Text)
        .map_err(|_| FrameError::Protocol("text frame is not valid UTF-8"))
}

fn parse_close(payload: &[u8]) -> Option<(u16, String)> {
    if payload.len() < 2 {
        return None;
    }
    let code = u16::from_be_bytes([payload[0], payload[1]]);
    Some((code, String::from_utf8_lossy(&payload[2..]).into_owned()))
}

/// Server frames are never masked, so writing is a header and the bytes.
pub fn write_message<W: Write>(writer: &mut W, message: &Message) -> std::io::Result<()> {
    let (opcode, payload) = match message {
        Message::Text(text) => (OP_TEXT, text.as_bytes().to_vec()),
        Message::Binary(bytes) => (OP_BINARY, bytes.clone()),
        Message::Ping(bytes) => (OP_PING, bytes.clone()),
        Message::Pong(bytes) => (OP_PONG, bytes.clone()),
        Message::Close(reason) => (OP_CLOSE, close_payload(reason.as_ref())),
    };

    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);
    if payload.len() < 126 {
        frame.push(payload.len() as u8);
    } else if payload.len() <= u16::MAX as usize {
        frame.push(126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    frame.extend_from_slice(&payload);
    writer.write_all(&frame)?;
    writer.flush()
}

fn close_payload(reason: Option<&(u16, String)>) -> Vec<u8> {
    let Some((code, text)) = reason else {
        return Vec::new();
    };
    let mut payload = code.to_be_bytes().to_vec();
    // A close reason is capped at 123 bytes by the 125-byte control payload.
    let mut end = text.len().min(123);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    payload.extend_from_slice(&text.as_bytes()[..end]);
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    fn masked(opcode: u8, final_fragment: bool, payload: &[u8]) -> Vec<u8> {
        let mask = [0x21u8, 0x7f, 0x9c, 0x03];
        let mut frame = vec![if final_fragment {
            0x80 | opcode
        } else {
            opcode
        }];
        assert!(payload.len() < 126, "test frames stay in the short form");
        frame.push(0x80 | payload.len() as u8);
        frame.extend_from_slice(&mask);
        for (index, byte) in payload.iter().enumerate() {
            frame.push(byte ^ mask[index % 4]);
        }
        frame
    }

    #[test]
    fn reads_a_masked_text_frame() {
        let bytes = masked(OP_TEXT, true, b"{\"type\":\"invoke\"}");
        let mut reader = MessageReader::new(bytes.as_slice());
        assert_eq!(
            reader.read().unwrap(),
            Message::Text("{\"type\":\"invoke\"}".into())
        );
    }

    #[test]
    fn reassembles_a_fragmented_text_message() {
        let mut bytes = masked(OP_TEXT, false, b"{\"type\":");
        bytes.extend(masked(OP_CONTINUATION, false, b"\"invoke\""));
        bytes.extend(masked(OP_CONTINUATION, true, b"}"));
        let mut reader = MessageReader::new(bytes.as_slice());
        assert_eq!(
            reader.read().unwrap(),
            Message::Text("{\"type\":\"invoke\"}".into())
        );
    }

    #[test]
    fn returns_a_control_frame_without_disturbing_a_partial_message() {
        let mut bytes = masked(OP_TEXT, false, b"half");
        bytes.extend(masked(OP_PING, true, b"beat"));
        bytes.extend(masked(OP_CONTINUATION, true, b"-way"));
        let mut reader = MessageReader::new(bytes.as_slice());
        assert_eq!(reader.read().unwrap(), Message::Ping(b"beat".to_vec()));
        assert_eq!(reader.read().unwrap(), Message::Text("half-way".into()));
    }

    #[test]
    fn reads_a_close_frame_with_its_code_and_reason() {
        let mut payload = 1000u16.to_be_bytes().to_vec();
        payload.extend_from_slice(b"bye");
        let bytes = masked(OP_CLOSE, true, &payload);
        let mut reader = MessageReader::new(bytes.as_slice());
        assert_eq!(
            reader.read().unwrap(),
            Message::Close(Some((1000, "bye".into())))
        );
    }

    #[test]
    fn refuses_an_unmasked_client_frame() {
        let bytes = vec![0x80 | OP_TEXT, 0x02, b'h', b'i'];
        let mut reader = MessageReader::new(bytes.as_slice());
        assert!(matches!(
            reader.read(),
            Err(FrameError::Protocol("client frames must be masked"))
        ));
    }

    #[test]
    fn writes_an_unmasked_frame_a_client_can_read_back() {
        let mut written = Vec::new();
        write_message(&mut written, &Message::Text("ok".into())).unwrap();
        assert_eq!(written, vec![0x80 | OP_TEXT, 0x02, b'o', b'k']);
    }

    #[test]
    fn writes_a_medium_payload_with_a_two_byte_length() {
        let mut written = Vec::new();
        let text = "x".repeat(200);
        write_message(&mut written, &Message::Text(text)).unwrap();
        assert_eq!(&written[..2], &[0x80 | OP_TEXT, 126]);
        assert_eq!(u16::from_be_bytes([written[2], written[3]]), 200);
    }
}

//! Token minting, comparison, and the pairing code that carries one.

use base64::Engine as _;

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// `length` characters drawn from a 64-symbol alphabet, so a 32-character
/// token carries 192 bits. Rejection is unnecessary because 64 divides 256.
pub fn random_token(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    // A failure here would mean the platform has no entropy at all. Panicking
    // is the honest answer: a predictable token is worse than no host.
    getrandom::fill(&mut bytes).expect("the platform must provide entropy");
    bytes
        .into_iter()
        .map(|byte| ALPHABET[(byte & 0x3F) as usize] as char)
        .collect()
}

/// Compares in time that does not depend on where the first difference is, so
/// a caller cannot walk a token out of the host one character at a time.
pub fn secret_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut difference = (left.len() ^ right.len()) as u8;
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        difference |= a ^ b;
    }
    difference == 0
}

/// A host name is shown in the chrome and stored on the client, so it stays
/// printable and short rather than whatever the machine's hostname contains.
pub fn sanitize_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(64)
        .collect();
    cleaned.trim().to_string()
}

pub const PAIRING_PREFIX: &str = "wavex-connect:";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPayload {
    pub version: u8,
    pub host_id: String,
    pub name: String,
    pub endpoint: String,
    pub token: String,
}

/// One string the user copies from the host and pastes into the client. It
/// carries the token, so the UI has to say plainly that it is a secret.
pub fn encode_pairing(payload: &PairingPayload) -> Result<String, String> {
    let json = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    Ok(format!(
        "{PAIRING_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
    ))
}

pub fn decode_pairing(code: &str) -> Result<PairingPayload, String> {
    let body = code
        .trim()
        .strip_prefix(PAIRING_PREFIX)
        .ok_or("That is not a wavex connection code")?;
    let json = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.trim())
        .map_err(|_| "That connection code is damaged".to_string())?;
    let payload: PairingPayload =
        serde_json::from_slice(&json).map_err(|_| "That connection code is damaged".to_string())?;
    if payload.version != 1 {
        return Err("That connection code came from a different version of wavex".into());
    }
    if payload.host_id.is_empty() || payload.token.is_empty() || payload.endpoint.is_empty() {
        return Err("That connection code is incomplete".into());
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mints_tokens_of_the_requested_length_from_the_alphabet() {
        let token = random_token(32);
        assert_eq!(token.chars().count(), 32);
        assert!(token.bytes().all(|byte| ALPHABET.contains(&byte)));
        assert_ne!(token, random_token(32));
    }

    #[test]
    fn compares_secrets_by_value_including_length() {
        assert!(secret_eq("abc", "abc"));
        assert!(!secret_eq("abc", "abd"));
        assert!(!secret_eq("abc", "abcd"));
        assert!(!secret_eq("", "a"));
    }

    #[test]
    fn round_trips_a_pairing_code() {
        let payload = PairingPayload {
            version: 1,
            host_id: "host-abc".into(),
            name: "Desk workstation".into(),
            endpoint: "ws://127.0.0.1:8787/api/v1/connect".into(),
            token: "long-lived-secret".into(),
        };
        let code = encode_pairing(&payload).unwrap();
        assert!(code.starts_with(PAIRING_PREFIX));
        let decoded = decode_pairing(&code).unwrap();
        assert_eq!(decoded.host_id, "host-abc");
        assert_eq!(decoded.token, "long-lived-secret");
    }

    #[test]
    fn refuses_a_code_that_is_not_one() {
        assert!(decode_pairing("ws://127.0.0.1:8787").is_err());
        assert!(decode_pairing("wavex-connect:not-base64!!").is_err());
    }

    #[test]
    fn keeps_a_host_name_printable_and_short() {
        assert_eq!(sanitize_name("  Desk\u{7} box \n"), "Desk box");
        assert_eq!(sanitize_name(&"n".repeat(200)).len(), 64);
    }
}

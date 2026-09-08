//! Whether a page will agree to be shown inside the panel's frame.
//!
//! A frame that is refused fires no event the WebView reports and leaves no
//! document this window may read: WebKit throws on the blocked frame's location
//! exactly as it throws on a page that really loaded, so the two are
//! indistinguishable from script. The answer is in the response headers, so it
//! is read from here instead of guessed at from there.
//!
//! This runs on the machine drawing the panel, never on a host: it is
//! deliberately absent from `connect/dispatch.rs`, because a host fetching an
//! address a client typed would be reaching into its own network on that
//! client's behalf.
use std::time::Duration;

use serde::Serialize;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const READ_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_REDIRECTS: u32 = 5;
const USER_AGENT: &str = "wavex";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrameProbe {
    /// Whether anything answered at all.
    pub reachable: bool,
    /// Whether what answered allows itself to be framed.
    pub embeddable: bool,
    /// The header that refused, for the panel to quote. `None` when nothing did.
    pub refused_by: Option<String>,
}

impl FrameProbe {
    fn unreachable() -> Self {
        Self {
            reachable: false,
            embeddable: false,
            refused_by: None,
        }
    }
}

#[tauri::command]
pub async fn probe_frame(url: String) -> FrameProbe {
    tauri::async_runtime::spawn_blocking(move || probe_frame_sync(&url))
        .await
        .unwrap_or_else(|_| FrameProbe::unreachable())
}

fn probe_frame_sync(url: &str) -> FrameProbe {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return FrameProbe::unreachable();
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .redirects(MAX_REDIRECTS)
        .user_agent(USER_AGENT)
        .build();
    // A refusal is a header on a real response, so a 4xx or 5xx is still an
    // answer worth reading rather than a failure to reach the server.
    let response = match agent.get(url).call() {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(_) => return FrameProbe::unreachable(),
    };
    let refused_by = frame_refusal(
        response.header("x-frame-options"),
        response.header("content-security-policy"),
    );
    FrameProbe {
        reachable: true,
        embeddable: refused_by.is_none(),
        refused_by: refused_by.map(str::to_owned),
    }
}

/// Which header refuses this page a frame, if either does.
///
/// The panel is not the page's own origin under any scheme it serves, so
/// `SAMEORIGIN` refuses it as squarely as `DENY` does, and a `frame-ancestors`
/// list refuses it unless it is the wildcard.
pub fn frame_refusal(
    x_frame_options: Option<&str>,
    content_security_policy: Option<&str>,
) -> Option<&'static str> {
    if let Some(value) = x_frame_options {
        let value = value.trim().to_ascii_lowercase();
        if value.starts_with("deny") || value.starts_with("sameorigin") {
            return Some("X-Frame-Options");
        }
    }
    let policy = content_security_policy?;
    for directive in policy.split(';') {
        let directive = directive.trim();
        let Some(sources) = directive
            .strip_prefix("frame-ancestors")
            .filter(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
        else {
            continue;
        };
        if sources.split_whitespace().any(|source| source == "*") {
            return None;
        }
        return Some("Content-Security-Policy");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_pages_are_embeddable() {
        assert_eq!(frame_refusal(None, None), None);
        assert_eq!(
            frame_refusal(None, Some("default-src 'self'; img-src *")),
            None
        );
    }

    #[test]
    fn x_frame_options_refuses_deny_and_sameorigin() {
        assert_eq!(frame_refusal(Some("DENY"), None), Some("X-Frame-Options"));
        assert_eq!(
            frame_refusal(Some(" sameorigin "), None),
            Some("X-Frame-Options")
        );
        assert_eq!(frame_refusal(Some("ALLOWALL"), None), None);
    }

    #[test]
    fn frame_ancestors_refuses_unless_it_is_the_wildcard() {
        assert_eq!(
            frame_refusal(None, Some("frame-ancestors 'none'")),
            Some("Content-Security-Policy")
        );
        assert_eq!(
            frame_refusal(
                None,
                Some("default-src 'self'; frame-ancestors https://a.example")
            ),
            Some("Content-Security-Policy")
        );
        assert_eq!(frame_refusal(None, Some("frame-ancestors *")), None);
    }

    #[test]
    fn a_directive_that_merely_starts_the_same_is_not_frame_ancestors() {
        assert_eq!(
            frame_refusal(None, Some("frame-ancestors-extra 'none'")),
            None
        );
        assert_eq!(frame_refusal(None, Some("frame-src 'none'")), None);
    }
}

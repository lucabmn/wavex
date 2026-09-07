//! Running wavex as a host with no window.
//!
//! The machine that owns the checkout and supervises the agents does not have
//! to be the machine that draws the UI, so the same binary can run as nothing
//! but a host: no window, no Dock icon, no menu bar, no popover. It serves
//! exactly the surface `connect/dispatch.rs` allows — a headless host is not a
//! way back to the commands a windowed one refuses.
//!
//! A headless host serves the profile it was started with. Switching profiles
//! is a window's gesture and stays off the allowlist, so the profile is chosen
//! once, on the command line.

use std::ffi::OsString;

use tauri::AppHandle;

const USAGE: &str = "\
wavex — a desktop client for installed coding-agent CLIs

USAGE:
    wavex [--headless [OPTIONS]]

OPTIONS:
    --headless               Serve this machine without opening a window.
    --port <PORT>            Listen on this loopback port (default: the port
                             this host last used, or a free one).
    --profile <ID>           Serve this profile's projects and history.
    --name <NAME>            Rename this host. A host that never had a window
                             has no other way to be called something.
    --print-pairing-code     Print the connection code, if stdout is a
                             terminal. It carries the host token.
    -h, --help               Print this help.

A host binds 127.0.0.1 and nothing else. Reaching it from another machine is
an SSH tunnel's or a private network's job.
";

/// How this process was asked to start. The windowed app is the default, and
/// an install that never passes a flag behaves exactly as it always has.
#[derive(Debug, Default, Clone)]
pub struct Launch {
    pub headless: bool,
    pub port: Option<u16>,
    pub profile: Option<String>,
    /// Already sanitized: a name that survives parsing is one the host can
    /// store as it stands.
    pub name: Option<String>,
    pub print_pairing_code: bool,
}

/// Marks a run that has no windows. Managed only when headless, so the window
/// paths can ask without carrying the flag through every call.
pub struct Headless;

impl Launch {
    pub fn from_args<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = OsString>,
    {
        let mut launch = Launch::default();
        let mut args = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned());
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--headless" => launch.headless = true,
                "--print-pairing-code" => launch.print_pairing_code = true,
                "--port" => {
                    let value = args.next().ok_or("--port needs a port number")?;
                    launch.port = Some(
                        value
                            .parse::<u16>()
                            .map_err(|_| format!("{value} is not a port number"))?,
                    );
                }
                "--profile" => {
                    let value = args.next().ok_or("--profile needs a profile id")?;
                    crate::profiles::validate_profile_id(&value)?;
                    launch.profile = Some(value);
                }
                "--name" => {
                    let value = args.next().ok_or("--name needs a name")?;
                    let cleaned = crate::connect::sanitize_name(&value);
                    if cleaned.is_empty() {
                        return Err("--name needs a name with something printable in it".into());
                    }
                    launch.name = Some(cleaned);
                }
                "-h" | "--help" => {
                    print!("{USAGE}");
                    std::process::exit(0);
                }
                // macOS hands a launched app `-psn_0_123456`, and a double
                // click must not be a usage error.
                other if other.starts_with("-psn_") => {}
                other => return Err(format!("Unknown option: {other}")),
            }
        }
        if !launch.headless
            && (launch.port.is_some() || launch.name.is_some() || launch.print_pairing_code)
        {
            return Err(
                "--port, --name, and --print-pairing-code only apply with --headless".into(),
            );
        }
        Ok(launch)
    }
}

/// Binds the requested profile, starts the host, and says where it listens.
pub fn start(app: &AppHandle, launch: &Launch) -> Result<(), String> {
    if let Some(profile) = &launch.profile {
        crate::profiles::profile_bind(app.clone(), profile.clone())?;
    }
    // Before it listens, so the first client to pair sees the name the
    // operator asked for rather than the one it is about to lose.
    if let Some(name) = &launch.name {
        crate::connect::set_host_name(app, name)?;
    }
    let status = crate::connect::start_for_headless(app, launch.port)?;
    let port = status.port.unwrap_or_default();
    println!(
        "wavex host \"{}\" is serving 127.0.0.1:{port} for profile \"{}\".",
        status.name,
        crate::profiles::active_profile(app)
    );
    println!(
        "It grants a connected client this machine's filesystem, processes, and Git checkouts, as you."
    );
    if launch.print_pairing_code {
        let code = crate::connect::pairing_code(app)?;
        print_pairing_code(&code);
    } else {
        println!("Run again with --print-pairing-code from a terminal to pair a client.");
    }
    Ok(())
}

/// The code carries the host token, and a token in a shared log is the same as
/// no token at all. A service manager captures stdout into a file that other
/// people and other processes read, so the code is printed only when stdout is
/// a terminal: an operator who asks for it over SSH gets it, a launchd or
/// systemd journal never does.
fn print_pairing_code(code: &str) {
    if stdout_is_terminal() {
        println!("Connection code (anyone holding it has this machine):");
        println!("{code}");
        return;
    }
    println!(
        "Refusing to print the connection code: stdout is not a terminal and the code carries this host's token."
    );
    println!("Run wavex --headless --print-pairing-code from a terminal instead.");
}

#[cfg(unix)]
fn stdout_is_terminal() -> bool {
    // SAFETY: `isatty` only reads the descriptor's mode.
    unsafe { libc::isatty(libc::STDOUT_FILENO) == 1 }
}

#[cfg(not(unix))]
fn stdout_is_terminal() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Launch, String> {
        Launch::from_args(args.iter().map(OsString::from))
    }

    #[test]
    fn defaults_to_the_windowed_app() {
        let launch = parse(&[]).expect("no arguments");
        assert!(!launch.headless);
        assert!(launch.port.is_none());
        assert!(launch.profile.is_none());
    }

    #[test]
    fn reads_a_headless_host_out_of_the_command_line() {
        let launch = parse(&["--headless", "--port", "48123", "--profile", "work"])
            .expect("headless arguments");
        assert!(launch.headless);
        assert_eq!(launch.port, Some(48123));
        assert_eq!(launch.profile.as_deref(), Some("work"));
    }

    #[test]
    fn refuses_a_profile_id_that_is_not_one() {
        assert!(parse(&["--headless", "--profile", "../elsewhere"]).is_err());
    }

    #[test]
    fn refuses_host_options_without_a_host() {
        assert!(parse(&["--port", "48123"]).is_err());
        assert!(parse(&["--name", "desk box"]).is_err());
        assert!(parse(&["--print-pairing-code"]).is_err());
    }

    #[test]
    fn cleans_the_name_a_host_will_be_stored_under() {
        let launch = parse(&["--headless", "--name", "  Desk\u{7} box \n"]).expect("a name");
        assert_eq!(launch.name.as_deref(), Some("Desk box"));
    }

    #[test]
    fn refuses_a_name_that_cleans_away_to_nothing() {
        // A host that asked to be renamed and silently kept its old name would
        // be the one thing the flag exists to prevent.
        assert!(parse(&["--headless", "--name", "  \u{7} "]).is_err());
        assert!(parse(&["--headless", "--name"]).is_err());
    }

    #[test]
    fn ignores_the_process_serial_number_a_double_click_passes() {
        assert!(parse(&["-psn_0_123456"]).is_ok());
    }
}

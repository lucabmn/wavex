//! Child processes wavex spawns on the user's behalf: git, gh, the agent CLIs,
//! and the shells behind a terminal.

use std::ffi::OsStr;
use std::io;
use std::process::{Child, Command};

/// Build a child process command with no console of its own.
///
/// Every program wavex runs is a console program. On Windows `CreateProcess`
/// gives one its own console window unless told otherwise, so a GUI build would
/// flash a black window over the app on every `git status` poll. `CREATE_NO_WINDOW`
/// keeps the child's stdio pipes and drops the window; on Unix this is the plain
/// constructor.
pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}

/// Apply the no-console flag to a command built elsewhere.
pub(crate) fn hide_console(#[allow(unused_variables)] cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Spawn a child with the flags required for a GUI host on Windows.
///
/// `CommandExt::creation_flags` replaces the complete flag set rather than
/// OR-ing with flags set earlier. Keeping the final flag composition here
/// prevents a later process-group setup from accidentally re-enabling a
/// console window for agent CLIs.
pub(crate) fn spawn(cmd: &mut Command) -> io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn()
}

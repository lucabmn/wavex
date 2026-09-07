#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let launch = match wavex_lib::headless::Launch::from_args(std::env::args_os().skip(1)) {
        Ok(launch) => launch,
        Err(error) => {
            eprintln!("wavex: {error}");
            std::process::exit(2);
        }
    };
    #[cfg(all(debug_assertions, target_os = "macos"))]
    wavex_lib::ensure_macos_dev_bundle();
    wavex_lib::run(launch)
}

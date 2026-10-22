#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition};

// Retangulo de teste em px CSS (relativo a janela)
const RX: f64 = 60.0;
const RY: f64 = 120.0;
const RW: f64 = 200.0;
const RH: f64 = 200.0;

struct State {
    ignore: AtomicBool,
    emu: AtomicBool,
}

#[tauri::command]
fn set_ignore(app: AppHandle, state: tauri::State<Arc<State>>, ignore: bool) -> Result<bool, String> {
    do_set_ignore(&app, &state, ignore)
}
#[tauri::command]
fn get_ignore(state: tauri::State<Arc<State>>) -> bool {
    state.ignore.load(Ordering::SeqCst)
}
#[tauri::command]
fn set_emulation(state: tauri::State<Arc<State>>, on: bool) {
    state.emu.store(on, Ordering::SeqCst)
}

fn do_set_ignore(app: &AppHandle, st: &State, ignore: bool) -> Result<bool, String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?;
    st.ignore.store(ignore, Ordering::SeqCst);
    Ok(ignore)
}

fn info(app: &AppHandle) -> String {
    let w = app.get_webview_window("main").unwrap();
    let mut s = format!(
        "win_scale={} outer_pos={:?} outer_size={:?}\n",
        w.scale_factor().unwrap(),
        w.outer_position().unwrap(),
        w.outer_size().unwrap()
    );
    for (i, m) in w.available_monitors().unwrap().iter().enumerate() {
        s += &format!("monitor{} scale={} pos={:?} size={:?}\n", i, m.scale_factor(), m.position(), m.size());
    }
    s
}

fn main() {
    let st = Arc::new(State { ignore: AtomicBool::new(false), emu: AtomicBool::new(false) });
    let st2 = st.clone();
    tauri::Builder::default()
        .manage(st.clone())
        .invoke_handler(tauri::generate_handler![set_ignore, get_ignore, set_emulation])
        .setup(move |app| {
            let h = app.handle().clone();
            // Thread de emulacao Teracota (33 ms)
            {
                let (h, st) = (h.clone(), st2.clone());
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_millis(33));
                    if !st.emu.load(Ordering::SeqCst) {
                        continue;
                    }
                    let Some(w) = h.get_webview_window("main") else { continue };
                    let (Ok(c), Ok(p), Ok(sf)) = (w.cursor_position(), w.outer_position(), w.scale_factor()) else {
                        continue;
                    };
                    let (x, y) = ((c.x - p.x as f64) / sf, (c.y - p.y as f64) / sf);
                    let inside = x >= RX && x < RX + RW && y >= RY && y < RY + RH;
                    let want_ignore = !inside;
                    if st.ignore.load(Ordering::SeqCst) != want_ignore {
                        let _ = do_set_ignore(&h, &st, want_ignore);
                    }
                });
            }
            // Canal de controle TCP para os testes (127.0.0.1:47600)
            {
                let (h, st) = (h.clone(), st2.clone());
                std::thread::spawn(move || {
                    let l = TcpListener::bind("127.0.0.1:47600").unwrap();
                    for conn in l.incoming() {
                        let Ok(mut c) = conn else { continue };
                        let mut line = String::new();
                        let _ = BufReader::new(c.try_clone().unwrap()).read_line(&mut line);
                        let p: Vec<&str> = line.trim().split_whitespace().collect();
                        let out = match p.as_slice() {
                            ["ignore", v] => format!("{:?}", do_set_ignore(&h, &st, *v == "1")),
                            ["get"] => format!(
                                "ignore={} emu={}",
                                st.ignore.load(Ordering::SeqCst),
                                st.emu.load(Ordering::SeqCst)
                            ),
                            ["emu", v] => {
                                st.emu.store(*v == "1", Ordering::SeqCst);
                                "ok".into()
                            }
                            ["info"] => info(&h),
                            ["move", x, y] => {
                                let w = h.get_webview_window("main").unwrap();
                                let r = w.set_position(PhysicalPosition::new(
                                    x.parse::<i32>().unwrap(),
                                    y.parse::<i32>().unwrap(),
                                ));
                                std::thread::sleep(Duration::from_millis(200));
                                format!("{:?}\n{}", r, info(&h))
                            }
                            ["drag"] => {
                                let w = h.get_webview_window("main").unwrap();
                                format!("start_dragging={:?}", w.start_dragging())
                            }
                            ["toggle", n, total_ms] => {
                                let (n, total): (u32, u64) = (n.parse().unwrap(), total_ms.parse().unwrap());
                                let t0 = Instant::now();
                                let mut errs = 0;
                                for i in 0..n {
                                    if do_set_ignore(&h, &st, i % 2 == 0).is_err() {
                                        errs += 1;
                                    }
                                    std::thread::sleep(Duration::from_millis(total / n as u64));
                                }
                                format!("toggles={} errors={} elapsed_ms={}", n, errs, t0.elapsed().as_millis())
                            }
                            ["quit"] => {
                                h.exit(0);
                                "bye".into()
                            }
                            _ => "unknown".into(),
                        };
                        let _ = c.write_all(out.as_bytes());
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run");
}

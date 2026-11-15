# Code Runner

Run the file you are editing in Acode with one tap. The plugin sends a command to the built-in Acode terminal (Alpine), shows the output there, and turns the play button into a stop button while the program is running. GUI programs open in Acode's browser through VNC, and Verilog files get a timing diagram.

## Features

- One-tap run and stop button in the editor header
- Works with terminal programs, including ones that read input
- 25+ languages out of the box, all editable
- Add, edit or delete languages, extensions and commands from the plugin settings
- GUI programs (tkinter, pygame, ...) open automatically in Acode's browser through VNC
- Verilog / SystemVerilog: compile, simulate and show a timing diagram with the bundled `wave.py`
- Detects missing tools and packages, prints the install commands and offers to install them
- Prints the exit code when the program finishes
- Compiled languages and simulations run in a temporary folder, so your project stays clean

## Requirements

- Acode with the built-in terminal feature
- The file must be saved in shared storage or on an SD card, so the terminal can see it at `/sdcard`
- The compiler or interpreter for each language inside the terminal (the plugin offers to install it, see "Missing tools")

## Usage

1. Open a file that has a configured extension.
2. Tap the play button in the header.
3. Watch the output in the "Runner" terminal tab.
4. Tap the button again to stop the program (it sends Ctrl+C).

## Default languages

Python, C, C++, Java, TypeScript, React (Vite dev server), PHP, Ruby, Go, Rust, Kotlin, Lua, Perl, R, Shell (bash when available), Fortran, Haskell, Elixir, OCaml, Verilog, SystemVerilog, SQL (SQLite), Julia, Dart, Zig.

JavaScript is left out on purpose because Acode already has its own runner for it.

## Custom languages and commands

Open the plugin settings and tap "Languages & commands". Every entry has a name, one or more extensions (comma separated) and a command. These placeholders can be used in a command:

- `[FILENAME]` full path of the file
- `[NAME]` file name without extension
- `[DIR]` folder that contains the file
- `[WAVE]` path of the bundled `wave.py`

Example: `python3 -u [FILENAME]`

If you updated the plugin and some default commands did not change, tap "Reset to defaults" once. Saved entries are kept as they are, and only missing languages are added automatically.

## VNC mode (GUI programs)

A file runs in VNC mode when it has a comment line with the word `vnc` (for example `# vnc`), or imports a GUI library (tkinter, turtle, pygame, PyQt, PySide, kivy, wx).

When you tap run, the plugin:

1. starts the X/VNC server (`Xvnc`) and the noVNC web bridge if they are not running,
2. starts `openbox` if it is installed, with big title bars and every window maximized,
3. sets `DISPLAY` and runs the program,
4. opens noVNC in Acode's browser as soon as the servers are ready.

The virtual screen follows the browser size, so it adapts when you rotate the phone.

Install once inside the terminal:

```
apk add tigervnc novnc websockify openbox font-dejavu
```

The display number, ports, screen size and title bar font size are constants at the top of `main.js` (`VNC_*`, `NOVNC_*`).

## Verilog

Verilog and SystemVerilog files run the `wave.py` that is bundled in this plugin: compile, simulate, then show a timing diagram and a results table in the terminal.

- For `x_tb.v` the design `x.v` is added automatically, and for `x.v` the testbench `x_tb.v`. If the partner file does not exist, only the open file is used.
- If the testbench has no `$dumpfile`, all signals are dumped automatically.
- Everything runs in a temporary folder that is deleted afterwards, so `sim_out` and `wave.vcd` never stay in your project. Relative paths inside the testbench (for example `$readmemh`) are therefore not found; use absolute paths.
- Needs `apk add iverilog` and `pip install pyvcd --break-system-packages`.

## Missing tools

Before a run the plugin checks, inside the terminal, whether the compiler or interpreter is installed and, for Python, whether every imported module is available. If something is missing it prints the install commands and asks:

```
Missing packages. Install with:
  apk add py3-tkinter
  pip install --break-system-packages foo
Install now? [y/N]
```

Answer `y` or `yes` (any case) to install. Anything else skips the install and runs the file anyway. The checked tools are listed in the `DEPS` table at the top of `main.js`, and you can add your own languages there.

If a command is still not found, the plugin reads the `apk add <package>` suggestion from the terminal's own "not installed" message (bash only), asks the same question, installs the package and runs the file again once.

## Temporary files

While a program runs, the plugin keeps a few small hidden files in shared storage (`/sdcard`): `.pyrun_cmd.sh`, `.pyrun_wave.py` and some marker files. They are removed after each run and recreated on the next one, so deleting them by hand is safe.

## Limitations

- Single-file programs only. Project builds (Maven, Gradle, Cargo, CMake) need a custom command.
- Files outside shared storage (for example private app folders) cannot be mapped to the terminal.
- Node projects stored on `/sdcard` can fail because of symlink limits. Keep them inside the Alpine home folder.
- Install suggestions from the terminal can be wrong for some tools. For example `java` suggests `java-common`, which is not a JDK, so Java uses `openjdk21` from the `DEPS` table.

## Troubleshooting

- The button disappears: no language is configured for the file extension.
- "Cannot map file path": the file is not in shared storage or on an SD card.
- "command not found": install the tool inside the terminal, for example `apk add gcc`.
- "Cannot track program state": the terminal cannot access `/sdcard`, or Acode has no storage permission.
- The stop icon stays after a crash: tap it once, or close the Runner terminal tab.
- `no display name and no $DISPLAY`: the file did not run in VNC mode. Add a `# vnc` comment at the top of the file.
- Java prints `Failed to mark memory page as executable - check if grsecurity/PaX is enabled`: the JVM fails to start because the Android kernel does not allow an executable stack inside the terminal. Run `java -version` in the terminal to confirm it is not caused by your code. A commonly reported workaround is `apk add patchelf` and then `patchelf --clear-execstack` on the `.so` files under `/usr/lib/jvm`; a different JDK version (for example `openjdk17`) may also behave differently.

## Author

Imran

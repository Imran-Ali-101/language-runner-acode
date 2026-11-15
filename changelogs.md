# Changelog

## 1.1.2
- Readme rewritten, changelog added.
- Java: tip for the "Failed to mark memory page as executable" JVM error in the troubleshooting section.

## 1.1.1
- If a command is not found, the terminal's `apk add <package>` suggestion is read and the plugin asks `Install now? [y/N]`, installs and runs the file again.
- The command script (`.pyrun_cmd.sh`), the bundled `wave.py` copy and the markers are removed after each run.
- Java added to the missing-tool table (`openjdk21`).

## 1.1.0
- `wave.py` is bundled inside the plugin (new `[WAVE]` placeholder).
- Missing tools and Python modules are detected before a run; install commands are shown and `y`/`yes` (any case) installs them.
- The long command is written to a script file and only a short line is typed in the terminal (avoids the 4096 character limit and the screen flash).

## 1.0.4
- Verilog / SystemVerilog run `wave.py` automatically and pick the testbench or design pair by name (`x.v` / `x_tb.v`).
- Runs happen in a temporary folder that is deleted afterwards.
- The VNC screen follows the browser size and rotation (`resize=remote`).
- Bigger title bar buttons in VNC mode (`VNC_TITLE_FONT`).
- `wave.py`: waveform is shown even when the testbench has no `$dumpfile`.

## 1.0.3
- The VNC viewer opens as soon as the servers are ready instead of after a fixed delay.
- Windows are maximized in VNC mode (openbox).

## 1.0.2
- File text is read from the editor first, so VNC detection works for every file location.
- Starts `Xvnc` itself (no separate VNC server needed) and optional `openbox`.

## 1.0.1
- VNC mode: GUI programs open in Acode's browser through noVNC.

## 1.0.0
- First release: one-tap run and stop button, editable language list, exit code output.

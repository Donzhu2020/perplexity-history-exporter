#!/usr/bin/env python3
"""
Auto-start the CLI and select "Start scraper (Library)".

This helper intentionally does not auto-confirm login. It leaves the browser
open so you can complete Perplexity authentication manually.
"""
import pty
import os
import sys
import time
import select
import subprocess


PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def run():
    master, slave = pty.openpty()

    env = os.environ.copy()
    env['TERM'] = 'xterm-256color'
    env['COLUMNS'] = '120'
    env['LINES'] = '40'

    proc = subprocess.Popen(
        ['npm', 'run', 'dev'],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        cwd=PROJECT_DIR,
    )

    os.close(slave)

    output_buffer = b''
    entered_scraper = False
    login_message_shown = False

    print(f"Starting Perplexity scraper from {PROJECT_DIR}...", flush=True)

    while proc.poll() is None:
        r, _, _ = select.select([master], [], [], 0.5)
        if r:
            try:
                data = os.read(master, 4096)
                output_buffer += data
                text = data.decode('utf-8', errors='replace')
                sys.stdout.write(text)
                sys.stdout.flush()

                if b'Start scraper' in output_buffer and not entered_scraper:
                    time.sleep(1)
                    os.write(master, b'\r')
                    entered_scraper = True
                    print("\n[AUTO] Selected 'Start scraper'", flush=True)
                    output_buffer = b''

                if (
                    b'Please log in manually in the browser window' in output_buffer
                    and not login_message_shown
                ):
                    login_message_shown = True
                    print(
                        "\n[INFO] Complete login in the browser window. "
                        "This helper will keep monitoring the export.",
                        flush=True,
                    )
                    output_buffer = b''

            except OSError:
                break

    proc.wait()
    os.close(master)
    print(f"\nProcess exited with code: {proc.returncode}")

if __name__ == '__main__':
    run()

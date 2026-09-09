"""Linux PTY smoke checks; uses only Python's standard library."""
import errno
import os
import pty
import re
import select
import signal
import sys
import time
import termios


def scenario(command, action):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)
    original_flags = termios.tcgetattr(fd)[3]
    transcript = b''
    reaped = False

    def expect(text):
        nonlocal transcript
        data = b''
        deadline = time.monotonic() + 12
        def plain(value):
            return re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', value)

        while text not in plain(data):
            assert time.monotonic() < deadline, repr((text, transcript, data))
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        raise AssertionError(repr((text, transcript, data))) from error
                    raise
                assert chunk, repr((text, transcript, data))
                data += chunk
                transcript += chunk
        return plain(data)

    def send(text):
        os.write(fd, text)

    try:
        initial = expect(b"Type 'q()' to quit R.")
        if b'\n> ' not in initial:
            expect(b'> ')
        code = action(send, expect, pid)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                reaped = True
                assert os.waitstatus_to_exitcode(status) == code, repr((status, transcript))
                break
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    transcript += os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
        assert reaped, repr(transcript)
        mask = termios.ECHO | termios.ICANON
        assert termios.tcgetattr(fd)[3] & mask == original_flags & mask
    finally:
        if not reaped:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        os.close(fd)


def interactive(send, expect, pid):
    # Cancellation must clear text on both sides of the cursor.
    send(b"stop('stale input')\x01\x03")
    expect(b'> ')
    send(b'f <- function(x) {\nx+1\n}\nf(41)\n')
    expect(b'[1] 42')
    send(b'f <- function(x) {\n')
    expect(b'+ ')
    send(b'\x03\x03')
    expect(b'> ')
    send(b'readline("name: ")\n')
    expect(b'\nname: ')
    send(b'\x03')
    expect(b'> ')
    send(b'repeat {}\n')
    time.sleep(0.2)
    send(b'\x03')
    expect(b'> ')
    send(b'6*7\n')
    expect(b'[1] 42')
    send(b'q()\n')
    return 0


def eof(send, expect, pid):
    send(b'\x04')
    return 0


def exit_status(send, expect, pid):
    send(b'q(save="no", status=7)\n')
    return 7


scenario([sys.argv[1], 'dist/cli.js'], interactive)
scenario(['npm', 'start'], eof)
scenario([sys.argv[1], 'dist/cli.js'], exit_status)


def terminate(send, expect, pid):
    os.kill(pid, signal.SIGTERM)
    return 143

scenario([sys.argv[1], 'dist/cli.js'], terminate)

print('PTY scenarios passed')

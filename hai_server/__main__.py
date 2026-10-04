import argparse
import json
import os
import signal
import threading

from .http import create_server


def main():
    parser = argparse.ArgumentParser(description='Serve Hai and the TASKS.md workspace API.')
    parser.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '4173')))
    parser.add_argument('--tasks-file', default=os.environ.get('HAI_TASKS_FILE', 'TASKS.md'))
    parser.add_argument('--dist-dir', default=os.environ.get('HAI_DIST_DIR', 'dist'))
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('PORT must be an integer between 0 and 65535.')
    os.environ['SHELL'] = '/bin/bash'
    def split(name, delimiter=','):
        return [part.strip() for part in os.environ[name].split(delimiter) if part.strip()] if name in os.environ else None
    server = create_server(args.tasks_file, args.dist_dir, host=args.host, port=args.port, allowed_hosts=split('HAI_ALLOWED_HOSTS'), allowed_origins=split('HAI_ALLOWED_ORIGINS'), project_roots=split('HAI_PROJECT_ROOTS', os.pathsep), remote_sources=json.loads(os.environ.get('HAI_REMOTE_SOURCES', '{}')))
    for sig in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(sig, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(json.dumps({'host': args.host, 'port': server.server_address[1]}), flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

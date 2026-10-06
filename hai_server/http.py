"""Private HTTP adapter. Sources and filesystem roots are configured by the operator."""
import json
import mimetypes
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from hai_tasks import TasksError, TasksStore, open_source

CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"


def create_server(tasks_file, dist_dir, *, host='127.0.0.1', port=4173, allowed_hosts=None, allowed_origins=None, project_roots=None, remote_sources=None):
    tasks_file = Path(tasks_file).expanduser().absolute()
    dist = Path(dist_dir).absolute()
    roots = list(dict.fromkeys([tasks_file.parent, *(Path(p).expanduser().absolute() for p in (project_roots if project_roots is not None else [tasks_file.parent.parent]))]))
    canonical_roots, stores = {}, {}
    selection_lock = threading.Lock()
    allowed_hosts = {'localhost', '127.0.0.1', '::1', *(allowed_hosts or [])}
    allowed_origins = set(allowed_origins or [])
    remote_sources = remote_sources or {}
    if not isinstance(remote_sources, dict) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', key) or not isinstance(uri, str) or not uri.startswith(('ssh://', 'github://')) for key, uri in remote_sources.items()):
        raise ValueError('HAI_REMOTE_SOURCES must map aliases to ssh:// or github:// sources.')
    remotes = {f'/@{key}': open_source(uri) for key, uri in remote_sources.items()}

    def select_source(source):
        if source in remotes:
            return remotes[source], dict(name=source[2:], path=source)
        file = tasks_file
        if source is not None:
            if not source.strip() or len(source) > 4096 or re.search(r'[\x00-\x1f\x7f\\]', source):
                raise TasksError('Enter a project directory or TASKS.md path.')
            if source.startswith('~') and source != '~' and not source.startswith('~/'):
                raise TasksError('Use an absolute server path or a path starting with ~/.')
            path = Path(source).expanduser()
            if not path.is_absolute():
                raise TasksError('Use an absolute server path or a path starting with ~/.')
            file = path if path.name == 'TASKS.md' or path == tasks_file or str(path) in stores else path / 'TASKS.md'
            # Lexically normalize without resolving symlinks before the root check.
            file = Path(os.path.abspath(file))
        with selection_lock:
            for root in roots:
                if root not in canonical_roots:
                    try:
                        canonical_roots[root] = root.resolve(strict=True)
                    except OSError as error:
                        raise TasksError(f'A configured project root is unavailable at {root}: {error}. Check HAI_PROJECT_ROOTS.', 503) from error
            if not any(file.is_relative_to(root) or file.is_relative_to(canonical_roots[root]) for root in roots):
                raise TasksError('Project is outside the allowed project roots. Check HAI_PROJECT_ROOTS.', 403)
            try:
                if file.is_symlink() or (file.exists() and not file.is_file()):
                    reason = 'a regular file, not a symbolic link' if file.is_symlink() else 'a regular file'
                    raise TasksError(f'TASKS.md must be {reason}: {file}', 422)
                canonical = file.resolve(strict=True)
            except OSError as error:
                raise TasksError(f'Cannot open TASKS.md at {file}: {error}', 404) from error
            if not any(canonical.is_relative_to(root) for root in canonical_roots.values()):
                raise TasksError('Project links must stay inside the allowed project roots.', 403)
            key = str(canonical)
            if key not in stores:
                stores[key] = TasksStore(canonical)
            return stores[key], dict(name=canonical.parent.name, path=key)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, format, *args):
            pass

        def send_content(self, status, content, content_type, **headers):
            content = content.encode('utf-8') if isinstance(content, str) else content
            self.send_response(status)
            for key, value in {'Content-Type': content_type, 'Content-Length': str(len(content)), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': CSP, **headers}.items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(content)

        def json(self, status, value, revision=None):
            headers = {'Cache-Control': 'no-store'}
            if revision:
                headers['ETag'] = f'"{revision}"'
            self.send_content(status, json.dumps(value, ensure_ascii=False), 'application/json; charset=utf-8', **headers)

        def body(self):
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise TasksError('Use application/json.', 415)
            maximum = 1024 * 1024
            length = self.headers.get('Content-Length')
            transfer = self.headers.get('Transfer-Encoding')
            if len(self.headers.get_all('Content-Length', [])) > 1 or (length and transfer):
                raise TasksError('Ambiguous request body framing.')
            if transfer:
                if transfer.lower() != 'chunked':
                    raise TasksError('Unsupported transfer encoding.')
                content = bytearray()
                while True:
                    line = self.rfile.readline(128)
                    try:
                        size = int(line.strip(), 16)
                    except ValueError:
                        raise TasksError('Invalid chunk size.') from None
                    if size < 0 or not line.endswith(b'\r\n'):
                        raise TasksError('Invalid chunk size.')
                    if len(content) + size > maximum:
                        raise TasksError('Request body exceeds 1 MB.', 413)
                    if size == 0:
                        if self.rfile.readline(8192) != b'\r\n':
                            raise TasksError('Request trailers are unsupported.')
                        break
                    chunk = self.rfile.read(size)
                    if len(chunk) != size or self.rfile.read(2) != b'\r\n':
                        raise TasksError('Incomplete request body.')
                    content.extend(chunk)
            else:
                if not length or not length.isdecimal():
                    raise TasksError('Provide Content-Length or chunked encoding.')
                size = int(length)
                if size > maximum:
                    raise TasksError('Request body exceeds 1 MB.', 413)
                content = self.rfile.read(size)
                if len(content) != size:
                    raise TasksError('Incomplete request body.')
            try:
                return json.loads(content)
            except (ValueError, UnicodeError):
                raise TasksError('Request body must be valid JSON.') from None

        def dispatch(self):
            try:
                host_header = self.headers.get('Host', '')
                host_url = urlsplit('http://' + host_header)
                if len(self.headers.get_all('Host', [])) != 1 or host_url.hostname not in allowed_hosts or host_url.username or host_url.path or host_url.query or host_url.fragment:
                    raise TasksError('Host is not allowed.', 403)
                url = urlsplit(self.path)
                method = self.command
                if method not in ['GET', 'HEAD']:
                    origin = self.headers.get('Origin')
                    if self.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and origin != f'http://{host_header}' and origin not in allowed_origins):
                        raise TasksError('Cross-origin writes are not allowed.', 403)
                if method == 'GET' and url.path == '/healthz':
                    select_source(None)[0].read()
                    return self.json(200, {'ok': True})
                query = parse_qs(url.query, keep_blank_values=True)
                if len(query.get('source', [])) > 1:
                    raise TasksError('Provide only one project source.')
                if url.path.startswith('/api/'):
                    if method == 'GET' and url.path == '/api/projects':
                        # Discover trackers without recursively traversing repositories or links.
                        candidates = {str(tasks_file), *remotes}
                        for root in roots:
                            if (root / 'TASKS.md').exists():
                                candidates.add(str(root / 'TASKS.md'))
                            for child in root.iterdir():
                                if not child.is_symlink() and child.is_dir() and (child / 'TASKS.md').exists():
                                    candidates.add(str(child / 'TASKS.md'))
                        with selection_lock:
                            candidates.update(stores)
                        selected = query.get('source', [None])[0]
                        if selected is not None:
                            try:
                                candidates.add(select_source(selected)[1]['path'])
                            except TasksError as error:
                                if error.status not in (404, 422):
                                    raise
                                # Keep an unavailable allowed selection in the partial-view diagnostics.
                                path = Path(selected).expanduser()
                                file = path if path.name == 'TASKS.md' or path == tasks_file else path / 'TASKS.md'
                                candidates.add(os.path.abspath(file))
                        sources = [{'name': path[2:] if path in remotes else Path(path).parent.name, 'path': path} for path in sorted(candidates)]
                        return self.json(200, {'sources': sources})
                    store, source = select_source(query.get('source', [None])[0])
                    if method == 'GET' and url.path == '/api/workspace':
                        result = store.read()
                        return self.json(200, dict(workspace=result['workspace'], revision=result['revision'], source=source), result['revision'])
                    if method == 'GET' and url.path == '/api/export':
                        format = query.get('format', ['tasks'])[0]
                        return self.send_content(200, store.export(format), 'application/json; charset=utf-8' if format == 'json' else 'text/markdown; charset=utf-8', **{'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="' + ('hai-workspace.json' if format == 'json' else 'TASKS.md') + '"'})
                    issue_path = re.fullmatch(r'/api/issues/([\w-]+)', url.path, re.ASCII)
                    reorder = url.path == '/api/backlog/order' and method == 'POST'
                    if reorder or (url.path == '/api/issues' and method == 'POST') or (issue_path and method in ['PATCH', 'DELETE']):
                        revision = self.headers.get('If-Match')
                        if revision is None:
                            raise TasksError('Load the workspace and provide its revision with If-Match.', 428)
                        operation = 'reorder' if reorder else {'POST': 'create', 'DELETE': 'delete', 'PATCH': 'update'}[method]
                        result = store.mutate(operation, revision, issue_path[1] if issue_path else None, {} if operation == 'delete' else self.body())
                        return self.json(201 if operation == 'create' else 200, dict(**result, source=source), result['revision'])
                    raise TasksError('API route not found.', 404)
                if method not in ['GET', 'HEAD']:
                    raise TasksError('Method not allowed.', 405)
                if re.search(r'%(?![0-9a-fA-F]{2})', url.path):
                    raise TasksError('Invalid URL path.')
                pathname = unquote(url.path, errors='strict')
                if '\0' in pathname or '\\' in pathname:
                    raise TasksError('Invalid URL path.')
                path = dist / (pathname.lstrip('/') if pathname != '/' else 'index.html')
                try:
                    canonical = path.resolve(strict=True)
                    if not canonical.is_relative_to(dist) or not canonical.is_file():
                        raise OSError()
                except OSError:
                    raise TasksError('File not found.', 404) from None
                content_type = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'}.get(canonical.suffix, mimetypes.guess_type(canonical)[0] or 'application/octet-stream')
                return self.send_content(200, canonical.read_bytes(), content_type, **{'Cache-Control': 'no-cache' if canonical.suffix == '.html' else 'public, max-age=3600'})
            except TasksError as error:
                self.json(error.status, {'error': str(error)})
            except (ValueError, UnicodeError):
                self.json(400, {'error': 'Invalid request.'})
            except OSError as error:
                self.json(503, {'error': f'The server could not read or save the tracker: {error}'})
            except Exception:
                import traceback
                traceback.print_exc()
                self.json(500, {'error': 'The server could not read or save the tracker.'})

        do_GET = do_HEAD = do_POST = do_PATCH = do_DELETE = do_OPTIONS = do_PUT = dispatch

    return ThreadingHTTPServer((host, port), Handler)

import argparse
import http.server
import socketserver
import sys
from pathlib import Path


class JsMimeRequestHandler(http.server.SimpleHTTPRequestHandler):
	# Ensure correct MIME types (Windows registry can map .js to text/plain)
	extensions_map = {
		**http.server.SimpleHTTPRequestHandler.extensions_map,
		".js": "application/javascript",
		".mjs": "application/javascript",
		".json": "application/json",
	}

	def log_message(self, format: str, *args):
		# Cleaner console output
		sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))


def main():
	parser = argparse.ArgumentParser(description="Static file server with correct JS MIME type")
	parser.add_argument("--port", "-p", type=int, default=5173, help="Port to serve on")
	parser.add_argument("--dir", "-d", type=str, default=str(Path(__file__).parent), help="Directory to serve")
	args = parser.parse_args()

	directory = Path(args.dir).resolve()
	print(f"Serving {directory} on http://localhost:{args.port}")

	handler_class = lambda *h_args, **h_kwargs: JsMimeRequestHandler(*h_args, directory=str(directory), **h_kwargs)

	with socketserver.ThreadingTCPServer(("", args.port), handler_class) as httpd:
		try:
			httpd.serve_forever()
		except KeyboardInterrupt:
			print("\nShutting down...")
		finally:
			httpd.server_close()


if __name__ == "__main__":
	main()



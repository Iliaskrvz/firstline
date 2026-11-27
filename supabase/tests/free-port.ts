// A free TCP port from the operating system, for the embedded Postgres of each test file. Random ports
// from fixed ranges overlapped between files running in parallel and made tests fail now and then.
import net from "node:net";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

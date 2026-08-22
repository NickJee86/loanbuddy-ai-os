// Local verification fallback for restricted libuv metrics.
const originalMemoryUsage = process.memoryUsage.bind(process);
function safeMemoryUsage() {
try { return originalMemoryUsage(); }
catch (error) {
if (error && error.code !== "ENOENT") throw error;
const heap = require("node:v8").getHeapStatistics();
return { rss: 0, heapTotal: heap.total_heap_size, heapUsed: heap.used_heap_size, external: 0, arrayBuffers: 0 };
}
}
safeMemoryUsage.rss = () => {
try { return originalMemoryUsage.rss ? originalMemoryUsage.rss() : 0; }
catch (error) { if (error && error.code !== "ENOENT") throw error; return 0; }
};
process.memoryUsage = safeMemoryUsage;
const os = require("node:os");
const originalNetworkInterfaces = os.networkInterfaces.bind(os);
os.networkInterfaces = () => {
try { return originalNetworkInterfaces(); }
catch (error) {
if (error && error.code !== "ERR_SYSTEM_ERROR") throw error;
return { lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }] };
}
};



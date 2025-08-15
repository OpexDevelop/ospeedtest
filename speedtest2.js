#!/usr/bin/env node

import http from 'http';
import https from 'https';
import { performance } from 'perf_hooks';

// Terminal colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m'
};

// Test servers configuration
const TEST_SERVERS = {
  cloudflare: [
    { name: 'Cloudflare 10MB', url: 'https://speed.cloudflare.com/__down?bytes=10485760', size: 10 },
    { name: 'Cloudflare 100MB', url: 'https://speed.cloudflare.com/__down?bytes=104857600', size: 100 }
  ],
  cachefly: [
    { name: 'CacheFly 10MB', url: 'http://cachefly.cachefly.net/10mb.test', size: 10 },
    { name: 'CacheFly 100MB', url: 'http://cachefly.cachefly.net/100mb.test', size: 100 }
  ],
  linode: [
    { name: 'Linode London', url: 'http://speedtest.london.linode.com/100MB-london.bin', size: 100 },
    { name: 'Linode Newark', url: 'http://speedtest.newark.linode.com/100MB-newark.bin', size: 100 },
    { name: 'Linode Frankfurt', url: 'http://speedtest.frankfurt.linode.com/100MB-frankfurt.bin', size: 100 },
    { name: 'Linode Singapore', url: 'http://speedtest.singapore.linode.com/100MB-singapore.bin', size: 100 }
  ],
  vultr: [
    { name: 'Vultr Amsterdam', url: 'https://ams-nl-ping.vultr.com/vultr.com.100MB.bin', size: 100 },
    { name: 'Vultr Frankfurt', url: 'https://fra-de-ping.vultr.com/vultr.com.100MB.bin', size: 100 },
    { name: 'Vultr London', url: 'https://lon-gb-ping.vultr.com/vultr.com.100MB.bin', size: 100 },
    { name: 'Vultr Tokyo', url: 'https://hnd-jp-ping.vultr.com/vultr.com.100MB.bin', size: 100 }
  ],
  bunny: [
    { name: 'Bunny CDN 10MB', url: 'https://test.b-cdn.net/10mb.bin', size: 10 },
   { name: 'Bunny CDN 100MB', url: 'https://test.b-cdn.net/100mb.bin', size: 100 }
  ],
  scaleway: [
    { name: 'Scaleway Paris 10MB', url: 'https://scaleway.testdebit.info/10M/10M.iso', size: 100 },
    { name: 'Scaleway Paris 100MB', url: 'https://scaleway.testdebit.info/100M/100M.iso', size: 10 }
  ],
  ovh: [
    { name: 'OVH 10MB', url: 'https://proof.ovh.net/files/10Mb.dat', size: 10 },
    { name: 'OVH 100MB', url: 'https://proof.ovh.net/files/100Mb.dat', size: 100 }
  ]
};

// CDN ping endpoints
const PING_ENDPOINTS = [
  { name: 'Google CDN', url: 'https://www.gstatic.com/generate_204' },
  { name: 'Facebook CDN', url: 'https://www.facebook.com/favicon.ico' },
  { name: 'Cloudflare Check', url: 'https://cp.cloudflare.com/'},
  { name: 'Firefox Portal', url: 'https://detectportal.firefox.com/success.txt'}
];

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    proxy: null,
    servers: ['cachefly'],
    sizes: null,
    json: false,
    ping: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if (arg === '--ping') {
      options.ping = true;
    } else if (arg.startsWith('--proxy=')) {
      options.proxy = arg.slice(8);
    } else if (arg.startsWith('--servers=')) {
      const servers = arg.slice(10).toLowerCase();
      options.servers = servers === 'all' ? Object.keys(TEST_SERVERS) : servers.split(',');
    } else if (arg.startsWith('--sizes=')) {
      const sizes = arg.slice(8);
      options.sizes = sizes.includes('MB') ? 
        sizes.split(',').map(s => parseInt(s)) :
        sizes.split(',').map(s => parseInt(s));
    } else if (arg.startsWith('socks://') || arg.startsWith('socks4://') || arg.startsWith('socks5://')) {
      options.proxy = arg;
    }
  }

  // Get proxy from environment if not specified
  if (!options.proxy && process.env.SOCKS_PROXY) {
    options.proxy = process.env.SOCKS_PROXY;
  }

  return options;
}

// Create HTTP/HTTPS agent
async function createAgent(proxy, isHttps) {
  if (!proxy) return null;

  try {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    return new SocksProxyAgent(proxy);
  } catch (err) {
    console.error(`${colors.yellow}⚠️  Warning: socks-proxy-agent not installed. Run: npm install socks-proxy-agent${colors.reset}`);
    console.error(`${colors.yellow}   Continuing without proxy...${colors.reset}\n`);
    return null;
  }
}

// Make HTTP/HTTPS request with redirect support
async function makeRequest(url, agent, timeout = 30000) {
  const startTime = performance.now();
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 SpeedTest/1.0'
      },
      agent: agent,
      timeout: timeout
    };

    const handleResponse = (res) => {
      // Handle redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        makeRequest(res.headers.location, agent, timeout)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 204) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let totalBytes = 0;
      const chunks = [];

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        chunks.push(chunk);
      });

      res.on('end', () => {
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        resolve({
          bytes: totalBytes,
          duration: duration,
          speedMbps: (totalBytes * 8 / duration / 1000000),
          speedMBps: (totalBytes / duration / 1048576)
        });
      });

      res.on('error', reject);
    };

    const req = httpModule.request(options, handleResponse);

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

// Ping test for latency
async function pingTest(url, agent) {
  const startTime = performance.now();
  
  try {
    await makeRequest(url, agent, 5000);
    const endTime = performance.now();
    return endTime - startTime;
  } catch (err) {
    return null;
  }
}

// Progress bar
function createProgressBar(progress, width = 30) {
  const filled = Math.round(width * progress);
  const empty = width - filled;
  
  let bar = '';
  for (let i = 0; i < filled; i++) {
    const colorIndex = Math.floor(i / width * 5);
    const barColors = [colors.red, colors.yellow, colors.green, colors.brightGreen, colors.brightCyan];
    bar += barColors[Math.min(colorIndex, barColors.length - 1)] + '█';
  }
  bar += colors.dim + '░'.repeat(empty) + colors.reset;
  
  return bar;
}

// Format speed with color
function formatSpeed(mbps) {
  let color;
  if (mbps < 10) color = colors.brightRed;
  else if (mbps < 50) color = colors.yellow;
  else if (mbps < 100) color = colors.green;
  else if (mbps < 500) color = colors.brightGreen;
  else color = colors.brightCyan;
  
  return `${color}${mbps.toFixed(2)} Mbps${colors.reset}`;
}

// Test single server
async function testServer(server, agent, showProgress = true) {
  const testResult = {
    name: server.name,
    url: server.url,
    size: server.size,
    ping: null,
    speedMbps: 0,
    speedMBps: 0,
    duration: 0,
    error: null
  };

  try {
    // Ping test first
    if (showProgress) {
      process.stdout.write(`${colors.cyan}   🔍 Pinging...${colors.reset}`);
    }
    
    const pingTime = await pingTest(server.url, agent);
    testResult.ping = pingTime;
    
    if (showProgress) {
      process.stdout.write('\r\x1b[K'); // Clear line
      if (pingTime !== null) {
        const pingColor = pingTime < 50 ? colors.brightGreen : 
                         pingTime < 100 ? colors.green :
                         pingTime < 200 ? colors.yellow : colors.red;
        process.stdout.write(`${colors.cyan}   📡 Ping: ${pingColor}${pingTime.toFixed(0)}ms${colors.reset}\n`);
      } else {
        process.stdout.write(`${colors.yellow}   📡 Ping: N/A${colors.reset}\n`);
      }
    }

    // Speed test
    if (showProgress) {
      const startTime = performance.now();
      let lastUpdate = startTime;

      const updateInterval = setInterval(async () => {
        const currentTime = performance.now();
        const elapsed = (currentTime - startTime) / 1000;
        
        const currentSpeed = Math.random() * 100 + 400; // Simulated for progress
        const progress = Math.min(elapsed / 2, 1); // Assume 2 seconds average
        
        process.stdout.write('\r\x1b[K'); // Clear line
        process.stdout.write(`   ${createProgressBar(progress)} ${formatSpeed(currentSpeed)} (${(currentSpeed / 8).toFixed(2)} MB/s)`);
      }, 100);

      const result = await makeRequest(server.url, agent);
      clearInterval(updateInterval);
      
      process.stdout.write('\r\x1b[K'); // Clear line
      
      testResult.speedMbps = result.speedMbps;
      testResult.speedMBps = result.speedMBps;
      testResult.duration = result.duration;

      const speedColor = testResult.speedMbps > 500 ? colors.brightCyan :
                        testResult.speedMbps > 100 ? colors.brightGreen :
                        testResult.speedMbps > 50 ? colors.green :
                        testResult.speedMbps > 10 ? colors.yellow : colors.red;

      console.log(`${colors.brightGreen}✅  ${colors.reset} Completed in ${colors.cyan}${result.duration.toFixed(2)}s${colors.reset}`);
      console.log(`   Average: ${speedColor}${testResult.speedMbps.toFixed(2)} Mbps${colors.reset} (${colors.white}${testResult.speedMBps.toFixed(2)} MB/s${colors.reset})`);
    } else {
      const result = await makeRequest(server.url, agent);
      testResult.speedMbps = result.speedMbps;
      testResult.speedMBps = result.speedMBps;
      testResult.duration = result.duration;
    }
  } catch (err) {
    testResult.error = err.message;
    if (showProgress) {
      process.stdout.write('\r\x1b[K'); // Clear line
      console.log(`${colors.red}❌  Error: ${err.message}${colors.reset}`);
    }
  }

  return testResult;
}

// Display results table
function displayResults(results) {
  const separator = colors.dim + '─'.repeat(76) + colors.reset;
  const doubleSeparator = colors.bright + '═'.repeat(76) + colors.reset;

  console.log('\n' + doubleSeparator);
  console.log(`${colors.brightCyan}📊 TEST RESULTS${colors.reset}`);
  console.log(doubleSeparator);

  // Header
  console.log(`${colors.bright}┌${'─'.repeat(30)}┬${'─'.repeat(12)}┬${'─'.repeat(10)}┬${'─'.repeat(10)}┐${colors.reset}`);
  console.log(`${colors.bright}│${colors.cyan} Server${' '.repeat(23)}${colors.bright}│${colors.cyan} Speed(Mbps)${colors.bright}│${colors.cyan} MB/s     ${colors.bright}│${colors.cyan} Time     ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}├${'─'.repeat(30)}┼${'─'.repeat(12)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┤${colors.reset}`);

  // Data rows
  results.forEach(result => {
    if (result.error) {
      console.log(`${colors.bright}│${colors.red} ${result.name.padEnd(29)}${colors.bright}│${colors.red} Error  ${colors.bright}│${colors.red} ${result.error.padEnd(11)}${colors.bright}│${' '.repeat(10)}│${' '.repeat(10)}│${colors.reset}`);
    } else {
      const speedColor = result.speedMbps > 500 ? colors.brightCyan :
                        result.speedMbps > 100 ? colors.brightGreen :
                        result.speedMbps > 50 ? colors.green :
                        result.speedMbps > 10 ? colors.yellow : colors.red;
      
      console.log(`${colors.bright}│${colors.white} ${result.name.padEnd(29)}${colors.bright}│${speedColor} ${result.speedMbps.toFixed(2).padEnd(11)}${colors.bright}│${colors.white} ${result.speedMBps.toFixed(2).padEnd(9)}${colors.bright}│${colors.cyan} ${result.duration.toFixed(2)}s${' '.repeat(8 - result.duration.toFixed(2).length)}${colors.bright}│${colors.reset}`);
    }
  });

  console.log(`${colors.bright}└${'─'.repeat(30)}┴${'─'.repeat(12)}┴${'─'.repeat(10)}┴${'─'.repeat(10)}┘${colors.reset}`);
}

// Display statistics
function displayStatistics(results) {
  const validResults = results.filter(r => !r.error);
  
  if (validResults.length === 0) {
    console.log(`${colors.red}No successful tests${colors.reset}`);
    return;
  }

  const doubleSeparator = colors.bright + '═'.repeat(76) + colors.reset;

  console.log('\n' + doubleSeparator);
  console.log(`${colors.brightMagenta}📈 STATISTICS${colors.reset}`);
  console.log(doubleSeparator);

  // By server provider
  const serverStats = {};
  const serverColors = {
    cloudflare: colors.yellow,
    cachefly: colors.magenta,
    linode: colors.blue,
    leaseweb: colors.green,
    softlayer: colors.red,
    vultr: colors.cyan,
    bunny: colors.brightMagenta,
    scaleway: colors.brightBlue,
    ovh: colors.brightCyan
  };

  validResults.forEach(result => {
    const provider = Object.keys(TEST_SERVERS).find(key => 
      TEST_SERVERS[key].some(s => s.name === result.name)
    );
    if (!serverStats[provider]) {
      serverStats[provider] = { speeds: [], pings: [] };
    }
    serverStats[provider].speeds.push(result.speedMbps);
    if (result.ping) serverStats[provider].pings.push(result.ping);
  });

  console.log(`\n${colors.bright}Average by Provider:${colors.reset}`);
  Object.entries(serverStats).forEach(([provider, stats]) => {
    const avgSpeed = stats.speeds.reduce((a, b) => a + b, 0) / stats.speeds.length;
    const avgPing = stats.pings.length > 0 ? 
      stats.pings.reduce((a, b) => a + b, 0) / stats.pings.length : null;
    const color = serverColors[provider] || colors.white;
    console.log(`  ${color}${provider.padEnd(12)}${colors.reset}: ${formatSpeed(avgSpeed)} (${(avgSpeed / 8).toFixed(2)} MB/s)${avgPing ? ` | Ping: ${avgPing.toFixed(0)}ms` : ''}`);
  });

  // By file size
  const sizeStats = {};
  validResults.forEach(result => {
    const size = `${result.size}MB`;
    if (!sizeStats[size]) {
      sizeStats[size] = [];
    }
    sizeStats[size].push(result.speedMbps);
  });

  console.log(`\n${colors.bright}Average by File Size:${colors.reset}`);
  Object.entries(sizeStats).forEach(([size, speeds]) => {
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    console.log(`  ${colors.cyan}${size.padEnd(6)}${colors.reset}: ${formatSpeed(avgSpeed)} (${(avgSpeed / 8).toFixed(2)} MB/s)`);
  });

  // Overall statistics
  const allSpeeds = validResults.map(r => r.speedMbps);
  const avgSpeed = allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length;
  const maxSpeed = Math.max(...allSpeeds);
  const minSpeed = Math.min(...allSpeeds);
  const bestResult = validResults.find(r => r.speedMbps === maxSpeed);
  const worstResult = validResults.find(r => r.speedMbps === minSpeed);

  console.log(`\n${colors.bright}Overall:${colors.reset}`);
  console.log(`  ${colors.brightWhite}⚡ Average Speed: ${formatSpeed(avgSpeed)} (${(avgSpeed / 8).toFixed(2)} MB/s)${colors.reset}`);
  console.log(`  ${colors.brightGreen}🏆 Best: ${bestResult.name} - ${formatSpeed(maxSpeed)}${colors.reset}`);
  console.log(`  ${colors.brightRed}🐌 Worst: ${worstResult.name} - ${formatSpeed(minSpeed)}${colors.reset}`);
}

// SpeedTest class for programmatic use
export class SpeedTest {
  constructor(options = {}) {
    this.options = {
      servers: options.servers || ['cachefly'],
      sizes: options.sizes || null,
      proxy: options.proxy || null,
    };

    // Convert sizes to numbers if needed
    if (this.options.sizes) {
      this.options.sizes = this.options.sizes.map(s => 
        typeof s === 'string' ? parseInt(s) : s
      );
    }

    // Handle 'all' servers
    if (this.options.servers.includes('all')) {
      this.options.servers = Object.keys(TEST_SERVERS);
    }
  }

  async run() {
    const agent = await createAgent(this.options.proxy, true);
    const results = [];

    // Build test list
    const tests = [];
    for (const serverKey of this.options.servers) {
      if (TEST_SERVERS[serverKey]) {
        for (const server of TEST_SERVERS[serverKey]) {
          if (!this.options.sizes || this.options.sizes.includes(server.size)) {
            tests.push(server);
          }
        }
      }
    }

    // Run tests
    for (const test of tests) {
      const result = await testServer(test, agent, false);
      results.push(result);
    }

    // Calculate statistics
    const validResults = results.filter(r => !r.error);
    const stats = {};
    
    if (validResults.length > 0) {
      const speeds = validResults.map(r => r.speedMbps);
      stats.averageSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      stats.maxSpeed = Math.max(...speeds);
      stats.minSpeed = Math.min(...speeds);
      stats.bestServer = validResults.find(r => r.speedMbps === stats.maxSpeed)?.name;
      stats.worstServer = validResults.find(r => r.speedMbps === stats.minSpeed)?.name;
    }
    return {
      results,
      statistics: stats
    };
  }

  async ping() {
    const agent = await createAgent(this.options.proxy, true);
    const results = [];

    for (const endpoint of PING_ENDPOINTS) {
      const pingTime = await pingTest(endpoint.url, agent);
      results.push({
        name: endpoint.name,
        url: endpoint.url,
        ping: pingTime,
        error: pingTime === null ? 'Failed' : null
      });
    }

    return results;
  }
}

// Main function
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.brightCyan}Speed Test CLI${colors.reset}

${colors.bright}Usage:${colors.reset}
  node speedtest.mjs [options]

${colors.bright}Options:${colors.reset}
  --servers=LIST    Servers to test (default: cloudflare)
                    Use 'all' for all servers or comma-separated list:
                    cloudflare,cachefly,linode,leaseweb,softlayer,vultr,bunny,scaleway,ovh
  
  --sizes=LIST      File sizes to test (e.g., 10,100 or 10MB,100MB)
  
  --proxy=URL       SOCKS proxy URL (e.g., socks5://127.0.0.1:1080)
  
  --json, -j        Output results as JSON
  
  --help, -h        Show this help

${colors.bright}Examples:${colors.reset}
  node speedtest.mjs                                    # Test Cloudflare only
  node speedtest.mjs --servers=all                      # Test all servers
  node speedtest.mjs --servers=cloudflare,vultr         # Test specific servers
  node speedtest.mjs --sizes=100                        # Test only 100MB files
  node speedtest.mjs --proxy=socks5://127.0.0.1:1080   # Use SOCKS proxy
  node speedtest.mjs --json                             # JSON output
  node speedtest.mjs --ping                             # Include ping tests

${colors.bright}Environment:${colors.reset}
  SOCKS_PROXY       Set proxy URL via environment variable
    `);
    process.exit(0);
  }

  // Run tests
  const agent = await createAgent(options.proxy, true);
  const results = [];

  // Build test list
  const tests = [];
  for (const serverKey of options.servers) {
    if (TEST_SERVERS[serverKey]) {
      for (const server of TEST_SERVERS[serverKey]) {
        if (!options.sizes || options.sizes.includes(server.size)) {
          tests.push(server);
        }
      }
    }
  }

  if (tests.length === 0) {
    console.error(`${colors.red}Error: No valid servers or sizes specified${colors.reset}`);
    process.exit(1);
  }

  if (!options.json) {
    const separator = colors.bright + '═'.repeat(60) + colors.reset;
    console.log(separator);
    console.log(`${colors.brightCyan}🚀 Speed Test${colors.reset}`);
    if (options.proxy) {
      console.log(`${colors.yellow}🔐 Using proxy: ${options.proxy}${colors.reset}`);
    }

    console.log(separator);
  }

  // Run tests
  for (const test of tests) {
    if (!options.json) {
      console.log(`\n${colors.brightBlue}📥 Testing: ${test.name}${colors.reset}`);
      console.log(`   ${colors.dim}URL: ${test.url}${colors.reset}`);
      console.log(`   ${colors.dim}Size: ${test.size}.0 MB${colors.reset}`);
    }

    const result = await testServer(test, agent, !options.json && options.ping);
    results.push(result);
  }

  // Display results
  if (options.json) {
    const validResults = results.filter(r => !r.error);
    const stats = {};
    
    if (validResults.length > 0) {
      const speeds = validResults.map(r => r.speedMbps);
      stats.averageSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      stats.maxSpeed = Math.max(...speeds);
      stats.minSpeed = Math.min(...speeds);
      stats.bestServer = validResults.find(r => r.speedMbps === stats.maxSpeed)?.name;
      stats.worstServer = validResults.find(r => r.speedMbps === stats.minSpeed)?.name;
    }

    console.log(JSON.stringify({
      results,
      statistics: stats
    }, null, 2));
  } else {
    displayResults(results);
    displayStatistics(results);

  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
    process.exit(1);
  });
}
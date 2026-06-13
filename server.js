const http = require('http');
const url = require('url');

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS for AI chat (if needed)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ----- AI Chat (Doubt Solver) -----
    if (pathname === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { message } = JSON.parse(body);
                if (!message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Message required' }));
                }

                const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.1-8b-instant',
                        messages: [
                            { role: 'system', content: 'You are a helpful study assistant. Answer in simple English.' },
                            { role: 'user', content: message }
                        ],
                        max_tokens: 500,
                        temperature: 0.7
                    })
                });

                if (!groqRes.ok) {
                    const err = await groqRes.text();
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: `Groq error: ${err}` }));
                }

                const data = await groqRes.json();
                const reply = data.choices?.[0]?.message?.content || 'No answer';
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ reply }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ----- Telegram Webhook -----
    if (pathname === '/telegram-webhook' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const update = JSON.parse(body);
                const msg = update.message || update.channel_post;
                if (!msg || (!msg.document && !msg.video && !msg.audio && !msg.voice)) {
                    res.writeHead(200);
                    return res.end('OK');
                }

                const caption = (msg.caption || '').trim();
                if (!caption) {
                    res.writeHead(200);
                    return res.end('OK');
                }

                let fileId, fileType, fileName;
                if (msg.document) {
                    fileId = msg.document.file_id;
                    fileType = 'PDF';
                    fileName = msg.document.file_name || 'document';
                } else if (msg.video) {
                    fileId = msg.video.file_id;
                    fileType = 'Video';
                    fileName = msg.video.file_name || 'video.mp4';
                } else if (msg.audio || msg.voice) {
                    fileId = (msg.audio || msg.voice).file_id;
                    fileType = 'Audio';
                    fileName = 'audio.mp3';
                } else {
                    res.writeHead(200);
                    return res.end('OK');
                }

                // Get file path from Telegram
                const tgUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`;
                const tgRes = await fetch(tgUrl);
                const tgData = await tgRes.json();
                if (!tgData.ok) {
                    res.writeHead(500);
                    return res.end('Telegram getFile failed');
                }

                const filePath = tgData.result.file_path;
                const downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

                // Save to Firebase Realtime Database
                const dbUrl = `https://studyflex-73c39-default-rtdb.firebaseio.com/resources/${caption}.json?auth=${process.env.FIREBASE_SECRET}`;
                const resource = {
                    title: fileName.replace(/\.[^/.]+$/, ''),
                    type: fileType,
                    url: downloadUrl
                };

                const fireRes = await fetch(dbUrl, {
                    method: 'POST',
                    body: JSON.stringify(resource)
                });

                if (!fireRes.ok) {
                    const errText = await fireRes.text();
                    res.writeHead(500);
                    return res.end(`Firebase error: ${errText}`);
                }

                res.writeHead(200);
                res.end('Resource added');
            } catch (e) {
                res.writeHead(500);
                res.end(e.message);
            }
        });
        return;
    }

    // Not Found
    res.writeHead(404);
    res.end('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

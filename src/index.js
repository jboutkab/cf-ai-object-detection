import html from '../static/webpage.html';

export default {
    async fetch(request, env) {
        const dateTime = new Date().toISOString();
        const sourceIP = request.headers.get('cf-connecting-ip') || 'unknown';
        const dateTimeAndSourceIP = `${dateTime} - ${sourceIP}`;
        console.log('DateTime and Source IP:', dateTimeAndSourceIP);
        
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/') {
            return new Response(html, {
                headers: { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'public, max-age=300'
                },
            });
        } 
        // Add this to your Worker to serve CSS/JS files
if (url.pathname.endsWith('.css')) {
    const css = await import('../static/styles.css');
    return new Response(css.default, {
        headers: { 'Content-Type': 'text/css' }
    });
}

if (url.pathname.endsWith('.js')) {
    const js = await import(`../static${url.pathname}`);
    return new Response(js.default, {
        headers: { 'Content-Type': 'application/javascript' }
    });
}
        
        if (request.method === 'POST' && url.pathname === '/process') {
            try {
                const { image } = await request.json();

                // Enhanced validation for both WebP and JPEG
                if (!image || (!image.startsWith('data:image/jpeg;base64,') && !image.startsWith('data:image/webp;base64,'))) {
                    return new Response(JSON.stringify({ error: 'Invalid image data. Must be JPEG or WebP format.' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Detect image format and decode accordingly
                const isWebP = image.startsWith('data:image/webp;base64,');
                const mimeType = isWebP ? 'image/webp' : 'image/jpeg';
                const base64Data = image.replace(/^data:image\/(jpeg|webp);base64,/, '');
                
                // Log image format and size for monitoring
                const imageSize = Math.round(base64Data.length * 0.75 / 1024); // Approximate KB
                console.log(`Processing ${mimeType} image: ${imageSize}KB`);

                let bytes;
                try {
                    const binaryString = atob(base64Data);
                    bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
                } catch (decodeError) {
                    console.error('Base64 decode error:', decodeError);
                    return new Response(JSON.stringify({ error: 'Invalid base64 image data' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Validate image size (prevent oversized uploads)
                const maxSizeKB = 2048; // 2MB limit
                if (imageSize > maxSizeKB) {
                    return new Response(JSON.stringify({ 
                        error: `Image too large: ${imageSize}KB. Maximum allowed: ${maxSizeKB}KB` 
                    }), {
                        status: 413,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Run AI inference with enhanced error handling
                let response;
                try {
                    response = await env.AI.run(
                        "@cf/facebook/detr-resnet-50",
                        { image: Array.from(bytes) },
                        {
                            gateway: {
                                id: "versent-techradar",
                                skipCache: false,
                                cacheTtl: 3360,
                            },
                        }
                    );
                } catch (aiError) {
                    console.error('AI inference error:', aiError);
                    return new Response(JSON.stringify({ 
                        error: 'AI processing failed',
                        details: aiError.message 
                    }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Enhanced result storage with metadata
                const resultData = {
                    detections: response,
                    metadata: {
                        sourceIP,
                        timestamp: dateTime,
                        imageFormat: mimeType,
                        imageSizeKB: imageSize,
                        detectionCount: response.length
                    }
                };

                // Store results in KV with error handling
                try {
                    await env.TECHRADAR_DETECTION_KV_NAMESPACE.put(
                        dateTimeAndSourceIP, 
                        JSON.stringify(resultData),
                        { expirationTtl: 86400 } // Expire after 24 hours
                    );
                } catch (kvError) {
                    console.error('KV storage error:', kvError);
                    // Continue processing even if KV fails
                }

                // Enhanced dangerous object detection
                const dangerousObjects = ['knife', 'scissors', 'gun', 'weapon', 'pistol', 'rifle'];
                const dangerousDetections = response.filter(item => 
                    dangerousObjects.some(dangerous => 
                        item.label.toLowerCase().includes(dangerous)
                    ) && item.score > 0.7 // Higher confidence threshold for alerts
                );

                console.log("Detection result:", JSON.stringify(response));
                console.log("Dangerous objects detected:", dangerousDetections.length);

                if (dangerousDetections.length > 0) {
                    // Send notification without blocking the response
                    sendSlackNotification(env, sourceIP, dateTime, dangerousDetections, mimeType, imageSize)
                        .catch(err => console.error('Slack notification failed:', err));
                }

                return new Response(JSON.stringify({ 
                    response,
                    metadata: {
                        processedFormat: mimeType,
                        originalSizeKB: imageSize,
                        detectionCount: response.length,
                        dangerousObjectsFound: dangerousDetections.length
                    }
                }), {
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                });

            } catch (error) {
                console.error('Processing error:', error);
                return new Response(JSON.stringify({ 
                    error: 'Processing failed',
                    details: error.message 
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // Handle OPTIONS for CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        return new Response('Not found', { status: 404 });
    }
};

async function sendSlackNotification(env, sourceIP, dateTime, dangerousDetections, imageFormat, imageSizeKB) {
    if (!env.SLACK_WEBHOOK) {
        console.log('Slack webhook not configured');
        return;
    }

    try {
        const detectionList = dangerousDetections
            .map(d => `${d.label} (${(d.score * 100).toFixed(1)}%)`)
            .join(', ');

        const compressionInfo = imageFormat === 'image/webp' ? 
            `📊 Optimized with WebP (${imageSizeKB}KB)` : 
            `📊 JPEG format (${imageSizeKB}KB)`;

        const message = {
            text: `🚨 Dangerous object detected!`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*🚨 SECURITY ALERT - Dangerous Object Detected*\n\n*📍 Location:* Camera 123 - Address 330\n*🎯 Objects Detected:* ${detectionList}\n*🌐 Source IP:* ${sourceIP}\n*⏰ Time:* ${dateTime}\n*${compressionInfo}*`
                    }
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `Powered by Cloudflare AI • Detection confidence >70%`
                        }
                    ]
                }
            ]
        };

        const response = await fetch(env.SLACK_WEBHOOK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        if (!response.ok) {
            throw new Error(`Slack API error: ${response.status}`);
        }

        console.log('Slack notification sent successfully for dangerous objects:', detectionList);
    } catch (error) {
        console.error('Slack notification error:', error);
        throw error;
    }
}
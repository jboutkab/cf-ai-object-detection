import html from '../static/webpage.html';

export default {
    async fetch(request, env) {
  const dateTime = new Date().toISOString();
  const sourceIP = request.headers.get('cf-connecting-ip');
  const dateTimeAndSourceIP = `${dateTime} - ${sourceIP}`;
  console.log('DateTime and Source IP:', dateTimeAndSourceIP);
      const url = new URL(request.url);
  
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      } else if (request.method === 'POST' && url.pathname === '/process') {
        const { image } = await request.json();
  
        // Decode base64 image data
        const base64Data = image.replace(/^data:image\/jpeg;base64,/, '');
        const binaryString = atob(base64Data);
        const bytes = [...Uint8Array.from(binaryString, c => c.charCodeAt(0))]

  
        const response = await env.AI.run(
          "@cf/facebook/detr-resnet-50",
          { image: Array.from(bytes)},
          {gateway:{
          
            id: "versent-techradar",
            skipCache: false,
            cacheTtl: 3360,
          },
        },
        
        );

        await env.TECHRADAR_DETECTION_KV_NAMESPACE.put(dateTimeAndSourceIP, JSON.stringify(response));

        // Check for knife detection and send a Slack message
        console.log("resul",JSON.stringify(response) )
        const knifeDetected = response.some(item => item.label.toLowerCase() === 'knife');
        console.log("knifedetected", knifeDetected)
        if (knifeDetected) {
            await sendSlackNotification(sourceIP, dateTime);
        }

        return new Response(JSON.stringify({ response }), {
          headers: { 'Content-Type': 'application/json' },
        });
    }

    async function sendSlackNotification(sourceIP, dateTime) {
        const slackWebhookUrl = env.SLACK_WEBHOOK; 
        console.log("slack webhook", slackWebhookUrl)
        const message = {
            text: `Knife detected Camera 123 - Address 330! Source IP: ${sourceIP}, Time: ${dateTime}`
        };

        await fetch(slackWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });
      }
  
      return new Response('Not found', { status: 404 });
    }
  };

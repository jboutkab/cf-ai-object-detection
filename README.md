Inspired from https://github.com/elizabethsiegle/cf-workers-ai-obj-detection-webcam

Wrangler Update:
-----------------
Rename wrangler.toml.rename to wrangler.toml
create KV: 
npx wrangler kv namespace create TECHRADAR_DETECTION_KV_NAMESPACE
Update wrangler.toml with KV name & ID generated previously
Add your Slack Webhook URL for notification


```
npm install
npm run dev
```

```
npm run deploy
```


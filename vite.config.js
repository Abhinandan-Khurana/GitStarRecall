var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var BASE_CSP_DIRECTIVES = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data:",
    "frame-src https://www.youtube.com https://player.vimeo.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
];
var DEV_CSP = __spreadArray([
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:* https://api.github.com https://api.openai.com https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://xethub.hf.co https://*.xethub.hf.co https://cdn-lfs.huggingface.co https://cdn.jsdelivr.net"
], BASE_CSP_DIRECTIVES, true).join("; ");
var PROD_CSP = __spreadArray([
    "script-src 'self' 'unsafe-eval'",
    "connect-src 'self' https://api.github.com https://api.openai.com https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://xethub.hf.co https://*.xethub.hf.co https://cdn-lfs.huggingface.co https://cdn.jsdelivr.net http://localhost:11434 http://localhost:1234 http://localhost:3001"
], BASE_CSP_DIRECTIVES, true).join("; ");
export default defineConfig(function (_a) {
    var command = _a.command;
    var contentSecurityPolicy = command === "serve" ? DEV_CSP : PROD_CSP;
    return {
        plugins: [react()],
        server: {
            port: 5173,
            headers: {
                "Content-Security-Policy": contentSecurityPolicy,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "strict-origin-when-cross-origin",
            },
        },
        preview: {
            headers: {
                "Content-Security-Policy": contentSecurityPolicy,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "strict-origin-when-cross-origin",
            },
        },
    };
});

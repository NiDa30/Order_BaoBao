import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const executablePath=process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
export default defineConfig({testDir:'./tests',use:{baseURL:'http://127.0.0.1:5173',headless:true,launchOptions:{executablePath,args:['--no-sandbox']}},webServer:{command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:true},projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]});

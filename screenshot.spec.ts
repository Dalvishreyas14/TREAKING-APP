import { test, expect } from '@playwright/test';

test('screenshot pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  
  const pages = [
    { name: '01-landing', url: '/' },
    { name: '02-sign-in', url: '/sign-in' },
    { name: '03-sign-up', url: '/sign-up' },
    { name: '04-dashboard', url: '/dashboard' },
    { name: '05-planner', url: '/planner' },
    { name: '06-tasks', url: '/tasks' },
    { name: '07-habits', url: '/habits' },
    { name: '08-focus', url: '/focus' },
    { name: '09-goals', url: '/goals' },
    { name: '10-projects', url: '/projects' },
    { name: '11-fitness', url: '/fitness' },
    { name: '12-study', url: '/study' },
    { name: '13-routines', url: '/routines' },
    { name: '14-journal', url: '/journal' },
    { name: '15-wellbeing', url: '/wellbeing' },
    { name: '16-analytics', url: '/analytics' },
    { name: '17-insights', url: '/insights' },
    { name: '18-ai', url: '/ai' },
    { name: '19-calendar', url: '/calendar' },
    { name: '20-notifications', url: '/notifications' },
    { name: '21-settings', url: '/settings' },
  ];

  for (const p of pages) {
    try {
      await page.goto(`http://localhost:3000${p.url}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `screenshots/${p.name}.png`, fullPage: true });
      console.log(`Captured ${p.name}`);
    } catch (e) {
      console.log(`Failed ${p.name}: ${e.message}`);
    }
  }
});

import {test,expect} from '@playwright/test';
import {mock,login} from './helpers/cloud.js';
test('unauthenticated users only see login even with legacy local orders',async({page})=>{
 await page.goto('/');await page.evaluate(()=>localStorage.setItem('lam-an-pos-v1',JSON.stringify({menu:[],orders:[{label:'Dữ liệu riêng không được hiện'}],closings:[]})));await page.reload();
 await expect(page.getByRole('heading',{name:'Đăng nhập',exact:true})).toBeVisible();await expect(page.locator('.sidebar,.topbar,.mobile-nav,.order-card')).toHaveCount(0);await expect(page.locator('#app')).not.toContainText('Dữ liệu riêng không được hiện');
 await page.getByLabel('Mật khẩu',{exact:true}).fill('synthetic-value');await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click();await expect(page.locator('#login-password')).toHaveAttribute('type','text');await expect(page.locator('#login-password')).toHaveValue('synthetic-value');await page.getByRole('button',{name:'Ẩn mật khẩu',exact:true}).click();await expect(page.locator('#login-password')).toHaveAttribute('type','password');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/login-${test.info().project.name}.png`,fullPage:true});
});
test('invalid credentials do not reveal dashboard and show a helpful error',async({page,context})=>{
 await mock(context,{workspace:null,loginError:true});await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('pos@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('synthetic-wrong-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu chưa đúng');await expect(page.locator('.sidebar,.topbar,.mobile-nav')).toHaveCount(0);await expect(page.getByRole('button',{name:'Đăng nhập',exact:true})).toBeEnabled();
});
test('session restores on reload; logout removes dashboard and stays logged out after reload',async({page,context})=>{
 await mock(context,{workspace:null});await login(page);await expect(page.locator('.topbar')).toBeVisible();await page.reload();await expect(page.locator('.topbar')).toBeVisible();await expect(page.locator('.auth-screen')).toHaveCount(0);await page.locator('.topbar [data-action=cloud]').click();await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await expect(page.locator('.auth-screen')).toBeVisible();await expect(page.locator('.sidebar,.topbar,.mobile-nav')).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'Đăng nhập',exact:true})).toBeVisible();await expect(page.locator('.sidebar,.topbar,.mobile-nav')).toHaveCount(0);
});

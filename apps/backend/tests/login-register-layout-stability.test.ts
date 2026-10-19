import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Regression tests for Login and Register Layout Stability and Dynamic Hero Image:
 * - Dynamic Admin-configured image source only; no hardcoded hero image asset (/ninearch.avif) in public directory or CSS.
 * - .login-left and .login-left-fallback define an immediate stable base background color and neutral gradient to prevent blank spaces.
 * - .login-split prevents horizontal overflow and confines viewport overflow on desktop.
 * - .login-right has fluid padding and scoped vertical scrolling (overflow-y: auto) to eliminate double/unwanted scrollbars.
 * - .register-grid organizes fields into a responsive 2-column layout on desktop to fit without unnecessary scrolling.
 * - AuthLayout supports formWrapperClassName and preserves accessibility.
 * - Authentication forms on login and register retain all fields, validations, and links.
 */

const WEB_SRC = path.resolve(__dirname, '../../web/src')
const PUBLIC_DIR = path.resolve(__dirname, '../../web/public')

const read = (file: string) => fs.readFileSync(path.join(WEB_SRC, file), 'utf8').replace(/\r\n/g, '\n')

describe('Dynamic Hero Image and Neutral Fallback (No Hardcoded Images)', () => {
  it('no hardcoded hero image asset (ninearch.avif) exists in public directory or is bundled', () => {
    const avifPath = path.join(PUBLIC_DIR, 'ninearch.avif')
    assert.equal(fs.existsSync(avifPath), false, 'ninearch.avif must not exist in public directory')
  })

  it('neither login.css nor AuthLayout.tsx references ninearch.avif or any hardcoded image files', () => {
    const css = read('app/login/login.css')
    const authLayout = read('components/auth/AuthLayout.tsx')
    assert.equal(/ninearch/i.test(css), false, 'login.css must not reference ninearch')
    assert.equal(/ninearch/i.test(authLayout), false, 'AuthLayout must not reference ninearch')

    // Ensure no hardcoded picture file url in login.css
    const urls = css.split('url(').slice(1).map((s) => s.split(')')[0])
    assert.deepEqual(urls.filter((u) => /[.](png|jpe?g|webp|avif|gif|svg)/i.test(u)), [], 'login.css must not point to any static picture file')
  })

  it('login.css defines .login-left-fallback and clean background styling to prevent blank spaces during load', () => {
    const css = read('app/login/login.css')
    assert.match(css, /\.login-left\s*\{[^}]*background-color:\s*var\(--theme-hero-bg,\s*transparent\)/, '.login-left has theme background color')
    assert.match(css, /\.login-left-fallback\s*\{[^}]*position:\s*absolute;/, '.login-left-fallback is positioned absolutely')
    assert.match(css, /\.login-left-fallback\s*\{[^}]*inset:\s*0;/, '.login-left-fallback covers entire hero area')
    assert.match(css, /\.login-left-fallback\s*\{[^}]*background-size:\s*cover;/, '.login-left-fallback has cover size')
    assert.match(css, /\.login-left-fallback\s*\{[^}]*background-position:\s*center;/, '.login-left-fallback has centered position')
  })

  it('AuthLayout renders .login-left-fallback layer with neutral fallback gradient and theme background', () => {
    const authLayout = read('components/auth/AuthLayout.tsx')
    assert.match(authLayout, /className="login-left-fallback"/, 'AuthLayout renders login-left-fallback element')
    assert.match(authLayout, /backgroundImage:\s*fallback/, 'fallback layer uses neutral gradient fallback')
    assert.match(authLayout, /backgroundColor:\s*'var\(--theme-hero-bg,\s*#0f172a\)'/, 'fallback layer uses theme background color')
  })
})

describe('Desktop and Mobile Viewport Overflow Containment', () => {
  const css = read('app/login/login.css')

  it('prevents accidental horizontal overflow on .login-split', () => {
    assert.match(css, /\.login-split\s*\{[^}]*overflow-x:\s*hidden;/)
  })

  it('contains desktop viewport height and prevents outer page scroll on desktop (min-width: 1025px)', () => {
    assert.match(css, /@media\s*\(min-width:\s*1025px\)[\s\S]*?\.login-split\s*\{[\s\S]*?height:\s*100(?:d)?vh;/)
    assert.match(css, /@media\s*\(min-width:\s*1025px\)[\s\S]*?\.login-split\s*\{[\s\S]*?max-height:\s*100dvh;/)
    assert.match(css, /@media\s*\(min-width:\s*1025px\)[\s\S]*?\.login-split\s*\{[\s\S]*?overflow:\s*hidden;/)
  })

  it('.login-right supports scoped vertical scrolling and fluid padding', () => {
    assert.match(css, /\.login-right\s*\{[^}]*overflow-y:\s*auto;/)
    assert.match(css, /\.login-right\s*\{[^}]*overflow-x:\s*hidden;/)
    assert.match(css, /\.login-right\s*\{[^}]*padding:\s*clamp\(/)
    assert.match(css, /\.login-form-wrapper\s*\{[^}]*padding:\s*clamp\(/)
  })

  it('preserves mobile responsive rules (max-width: 1024px)', () => {
    assert.match(css, /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.login-left\s*\{[\s\S]*?display:\s*none;/)
    assert.match(css, /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.login-mobile-brand\s*\{[\s\S]*?display:\s*flex;/)
  })
})

describe('Register Form Layout and Structure', () => {
  const css = read('app/login/login.css')
  const registerSrc = read('app/register/page.tsx')
  const authLayoutSrc = read('components/auth/AuthLayout.tsx')

  it('.register-grid is configured for 2-column layout on desktop and single column on mobile', () => {
    assert.match(css, /\.register-grid\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr;/)
    assert.match(css, /\.register-col-span-2\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/)
    assert.match(css, /@media\s*\(max-width:\s*640px\)\s*\{[^}]*\.register-grid\s*\{[^}]*grid-template-columns:\s*1fr;/)
  })

  it('AuthLayout supports optional formWrapperClassName', () => {
    assert.match(authLayoutSrc, /formWrapperClassName\?: string/)
    assert.match(authLayoutSrc, /login-form-wrapper\$\{formWrapperClassName/)
  })

  it('register page applies register-form-wrapper and wraps inputs inside register-grid', () => {
    assert.match(registerSrc, /<AuthLayout[^>]*formWrapperClassName="register-form-wrapper"/)
    assert.match(registerSrc, /<div className="register-grid">/)
    assert.match(registerSrc, /register-col-span-2/)
  })

  it('register page preserves all essential form controls and labels', () => {
    assert.match(registerSrc, /id="register-name"/)
    assert.match(registerSrc, /id="register-email"/)
    assert.match(registerSrc, /id="register-phone"/)
    assert.match(registerSrc, /id="register-password"/)
    assert.match(registerSrc, /id="register-confirm-password"/)
    assert.match(registerSrc, /type="checkbox"/)
    assert.match(registerSrc, /Create Account/)
    assert.match(registerSrc, /href="\/login"/)
  })
})

describe('Login Form Preservation', () => {
  const loginSrc = read('app/login/page.tsx')

  it('login page retains all essential controls, labels, and links', () => {
    assert.match(loginSrc, /id="login-email"/)
    assert.match(loginSrc, /id="login-password"/)
    assert.match(loginSrc, /Remember Me/)
    assert.match(loginSrc, /href="\/forgot-password"/)
    assert.match(loginSrc, /href="\/register"/)
    assert.match(loginSrc, /<AuthLayout ariaLabel="Sign In Form">/)
  })
})

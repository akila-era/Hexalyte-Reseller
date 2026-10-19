import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Regression tests for Login and Register Layout Stability and Image Loading:
 * - Local Sri Lankan hero background image asset (/ninearch.avif) is available, lightweight, and tracked.
 * - .login-left defines an immediate stable base background image and color to prevent blank spaces.
 * - .login-split prevents horizontal overflow and confines viewport overflow on desktop.
 * - .login-right has fluid padding and scoped vertical scrolling (overflow-y: auto) to eliminate double/unwanted scrollbars.
 * - .register-grid organizes fields into a responsive 2-column layout on desktop to fit without unnecessary scrolling.
 * - AuthLayout supports formWrapperClassName and preserves accessibility.
 * - Authentication forms on login and register retain all fields, validations, and links.
 */

const WEB_SRC = path.resolve(__dirname, '../../web/src')
const PUBLIC_DIR = path.resolve(__dirname, '../../web/public')

const read = (file: string) => fs.readFileSync(path.join(WEB_SRC, file), 'utf8').replace(/\r\n/g, '\n')

describe('Image Asset and Stability', () => {
  it('local Sri Lankan-themed image asset (ninearch.avif) exists in public directory and is lightweight (< 150 KB)', () => {
    const avifPath = path.join(PUBLIC_DIR, 'ninearch.avif')
    assert.ok(fs.existsSync(avifPath), 'public/ninearch.avif must exist')
    const size = fs.statSync(avifPath).size
    assert.ok(size > 10_000, `image file size ${size} should be a valid image`)
    assert.ok(size < 150_000, `image file size ${size} should be lightweight (< 150 KB)`)
  })

  it('login.css declares stable base background image and background color on .login-left', () => {
    const css = read('app/login/login.css')
    assert.match(css, /\.login-left\s*\{[^}]*background-image:\s*url\(['"]?\/ninearch\.avif['"]?\)/, '.login-left has ninearch.avif')
    assert.match(css, /\.login-left\s*\{[^}]*background-color:\s*var\(--theme-hero-bg,\s*transparent\)/, '.login-left has theme background color')
    assert.match(css, /\.login-left\s*\{[^}]*background-size:\s*cover;/, '.login-left covers full container')
    assert.match(css, /\.login-left\s*\{[^}]*background-position:\s*center;/, '.login-left centers image')
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

import type { TranslateRequest, TranslatorAdapter } from './types';

export interface TencentTmtConfig {
  secretId: string;
  secretKey: string;
  region?: string;
}

const SERVICE = 'tmt';
const HOST = 'tmt.tencentcloudapi.com';
const ACTION = 'TextTranslate';
const VERSION = '2018-03-21';

function mapTencentLang(lang: string): string {
  const lower = lang.trim().toLowerCase();
  if (!lower || lower === 'auto') return 'auto';
  if (lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh') return 'zh';
  if (lower === 'zh-tw' || lower === 'zh-hant') return 'zh-TW';
  return lower.split('-')[0];
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(digest));
}

async function hmacSha256(
  key: Uint8Array | string,
  message: string
): Promise<Uint8Array> {
  const rawKey =
    typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message)
  );
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Pure Web Crypto TC3-HMAC-SHA256 signer for Tencent Cloud TMT API.
 */
export async function buildTencentTc3Authorization(params: {
  secretId: string;
  secretKey: string;
  payload: string;
  timestampSec: number;
}): Promise<{ authorization: string; timestamp: string }> {
  const date = new Date(params.timestampSec * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = await sha256Hex(params.payload);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(params.timestampSec),
    credentialScope,
    hashedCanonical,
  ].join('\n');

  const secretDate = await hmacSha256(`TC3${params.secretKey}`, date);
  const secretService = await hmacSha256(secretDate, SERVICE);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = toHex(await hmacSha256(secretSigning, stringToSign));

  const authorization =
    `TC3-HMAC-SHA256 Credential=${params.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, timestamp: String(params.timestampSec) };
}

/**
 * Official Tencent Cloud Machine Translation (腾讯翻译君) Adapter.
 * Direct mainland China connection, 5,000,000 FREE characters every month!
 */
export class TencentTmtTranslator implements TranslatorAdapter {
  readonly id = 'tencent' as const;

  constructor(private readonly config: TencentTmtConfig) {}

  async translate(request: TranslateRequest): Promise<string> {
    const text = request.text.trim();
    if (!text) return '';

    const secretId = this.config.secretId.trim();
    const secretKey = this.config.secretKey.trim();
    if (!secretId || !secretKey) {
      throw new Error('请填写腾讯云 SecretId 与 SecretKey（每月免费 500 万字符）。');
    }

    const payload = JSON.stringify({
      SourceText: text,
      Source: mapTencentLang(request.sourceLang),
      Target: mapTencentLang(request.targetLang || 'zh-CN'),
      ProjectId: 0,
    });

    const timestampSec = Math.floor(Date.now() / 1000);
    const { authorization, timestamp } = await buildTencentTc3Authorization({
      secretId,
      secretKey,
      payload,
      timestampSec,
    });

    const res = await fetch(`https://${HOST}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: authorization,
        'X-TC-Action': ACTION,
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': timestamp,
        'X-TC-Region': this.config.region || 'ap-beijing',
      },
      body: payload,
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`Tencent TMT HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      Response?: {
        TargetText?: string;
        Error?: { Code?: string; Message?: string };
      };
    };

    if (data.Response?.Error) {
      throw new Error(
        `腾讯翻译错误 (${data.Response.Error.Code}): ${data.Response.Error.Message}`
      );
    }

    return (data.Response?.TargetText ?? '').trim();
  }
}

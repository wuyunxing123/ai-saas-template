/**
 * R2 StorageProvider
 *
 * 唯一允许直接引用 @aws-sdk/client-s3 的文件。
 * 复用当前项目的 R2 配置（env 变量名不变）。
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

import type { StorageProvider, StorageObject } from '../types'
import { StorageError } from '../errors'

export class R2StorageProvider implements StorageProvider {
  readonly name = 'r2'
  private client: S3Client | null = null
  private bucketName: string | null = null
  private publicUrlBase: string | null = null

  constructor() {
    this.initialize()
  }

  private initialize() {
    const accountId = process.env.R2_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const bucketName = process.env.R2_BUCKET_NAME
    const publicUrl = process.env.R2_PUBLIC_URL

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      console.warn('[Storage] R2 not configured - missing environment variables')
      return
    }

    this.bucketName = bucketName
    // 优先使用显式配置的公网地址；否则按标准格式拼接
    this.publicUrlBase =
      publicUrl || `https://${bucketName}.${accountId}.r2.cloudflarestorage.com`

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: {
        requestTimeout: 30000,
        connectionTimeout: 10000,
      },
    })

    console.log('[Storage] R2 provider initialized')
  }

  isConfigured(): boolean {
    return this.client !== null && this.bucketName !== null
  }

  async upload(
    key: string,
    data: Blob | ArrayBuffer | Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<StorageObject> {
    if (!this.client || !this.bucketName) {
      throw new StorageError('R2 storage not configured', 'NOT_CONFIGURED')
    }

    const body = data instanceof Blob ? await data.arrayBuffer() : data
    const payload = body instanceof ArrayBuffer ? new Uint8Array(body) : body

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: payload,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000',
          Metadata: metadata,
        })
      )
    } catch (error) {
      throw new StorageError(
        `R2 upload failed for key: ${key}`,
        'UPLOAD_FAILED',
        error
      )
    }

    return {
      key,
      url: this.getUrl(key),
      contentType,
      provider: this.name,
      metadata,
    }
  }

  getUrl(key: string): string {
    if (!this.publicUrlBase) {
      throw new StorageError('R2 public URL not configured', 'NOT_CONFIGURED')
    }
    return `${this.publicUrlBase}/${key}`
  }

  async delete(key: string): Promise<void> {
    if (!this.client || !this.bucketName) {
      throw new StorageError('R2 storage not configured', 'NOT_CONFIGURED')
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      )
    } catch (error: any) {
      // 404 视为已删除（幂等）
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return
      }
      throw new StorageError(
        `R2 delete failed for key: ${key}`,
        'DELETE_FAILED',
        error
      )
    }
  }
}

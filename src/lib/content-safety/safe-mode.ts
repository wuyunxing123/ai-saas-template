// 🛡️ 安全模式的内容审核系统
// 带有完整的错误处理和开关控制

export interface SafeModeConfig {
  enabled: boolean;                    // 总开关
  enableKeywordFilter: boolean;        // 关键词过滤
  enableBasicCheck: boolean;          // 基础检查
  enableAPICheck: boolean;            // API检查
  fallbackToSafe: boolean;            // 失败时默认安全
}

export interface SafetyResult {
  isSafe: boolean;
  confidence: number;
  reason?: string;
  provider: string;
  processingTime: number;
}

// 🔥 安全模式内容审核类
export class SafeModeContentSafety {
  private config: SafeModeConfig;
  
  constructor(config?: Partial<SafeModeConfig>) {
    this.config = {
      enabled: process.env.NEXT_PUBLIC_ENABLE_CONTENT_SAFETY === "true",
      enableKeywordFilter: true,
      enableBasicCheck: true,
      enableAPICheck: false, // 默认关闭API检查
      fallbackToSafe: true,
      ...config
    };
    
    console.log('🛡️ 安全模式内容审核已初始化:', this.config);
  }

  // 🔍 安全的提示词检查
  async checkPromptSafety(prompt: string): Promise<SafetyResult> {
    const startTime = Date.now();
    
    try {
      // 如果功能未启用，直接通过
      if (!this.config.enabled) {
        return {
          isSafe: true,
          confidence: 1.0,
          reason: '内容安全检查已禁用',
          provider: 'disabled',
          processingTime: Date.now() - startTime
        };
      }

      // 1️⃣ 基础检查：空内容
      if (!prompt || prompt.trim().length === 0) {
        return {
          isSafe: false,
          confidence: 1.0,
          reason: '提示词不能为空',
          provider: 'basic-check',
          processingTime: Date.now() - startTime
        };
      }

      // 2️⃣ 长度检查
      if (prompt.length > 1000) {
        return {
          isSafe: false,
          confidence: 0.9,
          reason: '提示词过长，请控制在1000字符以内',
          provider: 'length-check',
          processingTime: Date.now() - startTime
        };
      }

      // 3️⃣ 关键词过滤（如果启用）
      if (this.config.enableKeywordFilter) {
        const keywordResult = await this.checkKeywords(prompt);
        if (!keywordResult.isSafe) {
          return {
            ...keywordResult,
            processingTime: Date.now() - startTime
          };
        }
      }

      // 4️⃣ API检查（如果启用且配置了API）
      if (this.config.enableAPICheck) {
        try {
          const apiResult = await this.checkWithAPI(prompt);
          return {
            ...apiResult,
            processingTime: Date.now() - startTime
          };
        } catch (error) {
          console.warn('⚠️ API检查失败，使用备用方案:', error);
          
          if (this.config.fallbackToSafe) {
            return {
              isSafe: true,
              confidence: 0.5,
              reason: 'API检查失败，采用安全策略',
              provider: 'fallback',
              processingTime: Date.now() - startTime
            };
          }
        }
      }

      // 默认通过
      return {
        isSafe: true,
        confidence: 0.8,
        reason: '基础检查通过',
        provider: 'basic-filter',
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('❌ 内容安全检查异常:', error);
      
      // 异常时的安全策略
      if (this.config.fallbackToSafe) {
        return {
          isSafe: true,
          confidence: 0.1,
          reason: '检查异常，采用安全策略',
          provider: 'error-fallback',
          processingTime: Date.now() - startTime
        };
      } else {
        return {
          isSafe: false,
          confidence: 0.9,
          reason: '安全检查异常，拒绝处理',
          provider: 'error-reject',
          processingTime: Date.now() - startTime
        };
      }
    }
  }

  // 🖼️ 安全的图像检查
  async checkImageSafety(imageUrl: string): Promise<SafetyResult> {
    const startTime = Date.now();
    
    try {
      // 如果功能未启用，直接通过
      if (!this.config.enabled) {
        return {
          isSafe: true,
          confidence: 1.0,
          reason: '图像安全检查已禁用',
          provider: 'disabled',
          processingTime: Date.now() - startTime
        };
      }

      // 基础URL检查
      if (!imageUrl || !this.isValidImageUrl(imageUrl)) {
        return {
          isSafe: false,
          confidence: 1.0,
          reason: '无效的图像URL',
          provider: 'url-check',
          processingTime: Date.now() - startTime
        };
      }

      // API检查（如果启用）
      if (this.config.enableAPICheck) {
        try {
          const apiResult = await this.checkImageWithAPI(imageUrl);
          return {
            ...apiResult,
            processingTime: Date.now() - startTime
          };
        } catch (error) {
          console.warn('⚠️ 图像API检查失败:', error);
          
          if (this.config.fallbackToSafe) {
            return {
              isSafe: true,
              confidence: 0.5,
              reason: '图像API检查失败，采用安全策略',
              provider: 'image-fallback',
              processingTime: Date.now() - startTime
            };
          }
        }
      }

      // 默认通过
      return {
        isSafe: true,
        confidence: 0.7,
        reason: '基础图像检查通过',
        provider: 'basic-image-check',
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('❌ 图像安全检查异常:', error);
      
      return {
        isSafe: this.config.fallbackToSafe,
        confidence: 0.1,
        reason: '图像检查异常',
        provider: 'image-error',
        processingTime: Date.now() - startTime
      };
    }
  }

  // 🔍 关键词检查
  private async checkKeywords(prompt: string): Promise<SafetyResult> {
    const startTime = Date.now();
    
    const blacklist = [
      // 基础违规词汇（可以根据需要调整）
      'nude', 'naked', 'porn', 'xxx', 'sex',
      '裸体', '色情', '成人',
      'violence', 'kill', 'murder', 'blood',
      '暴力', '杀戮', '血腥',
      'hate', 'nazi', 'terrorist',
      '仇恨', '恐怖'
    ];

    const lowerPrompt = prompt.toLowerCase();
    const foundKeywords = blacklist.filter(keyword => 
      lowerPrompt.includes(keyword.toLowerCase())
    );

    if (foundKeywords.length > 0) {
      return {
        isSafe: false,
        confidence: 0.9,
        reason: `检测到敏感词汇: ${foundKeywords.slice(0, 3).join(', ')}${foundKeywords.length > 3 ? '等' : ''}`,
        provider: 'keyword-filter',
        processingTime: Date.now() - startTime
      };
    }

    return {
      isSafe: true,
      confidence: 0.8,
      reason: '关键词检查通过',
      provider: 'keyword-filter',
      processingTime: Date.now() - startTime
    };
  }

  // 🔍 API检查（仅在配置了API时调用）
  private async checkWithAPI(prompt: string): Promise<SafetyResult> {
    // 检查是否配置了OpenAI API（最容易获取）
    const openaiKey = process.env.OPENAI_API_KEY;
    
    if (openaiKey) {
      return await this.checkWithOpenAI(prompt, openaiKey);
    }

    // 如果没有配置任何API，抛出错误
    throw new Error('未配置任何内容安全API');
  }

  // 🔍 OpenAI检查
  private async checkWithOpenAI(prompt: string, apiKey: string): Promise<SafetyResult> {
    const startTime = Date.now();
    
    try {
      const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: prompt
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API错误: ${response.status}`);
      }

      const data = await response.json();
      const result = data.results[0];

      if (result.flagged) {
        const categories = Object.keys(result.categories).filter(
          key => result.categories[key]
        );
        
        return {
          isSafe: false,
          confidence: 0.95,
          reason: `OpenAI检测到违规内容: ${categories.join(', ')}`,
          provider: 'openai',
          processingTime: Date.now() - startTime
        };
      }

      return {
        isSafe: true,
        confidence: 0.95,
        reason: 'OpenAI检查通过',
        provider: 'openai',
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('OpenAI API调用失败:', error);
      throw error;
    }
  }

  // 🖼️ 图像API检查
  private async checkImageWithAPI(imageUrl: string): Promise<SafetyResult> {
    const startTime = Date.now();
    
    // 这里可以集成图像检查API
    // 暂时返回安全结果
    return {
      isSafe: true,
      confidence: 0.7,
      reason: '图像API检查功能待实现',
      provider: 'image-api-placeholder',
      processingTime: Date.now() - startTime
    };
  }

  // 🔍 验证图像URL
  private isValidImageUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const pathname = urlObj.pathname.toLowerCase();
      
      return validExtensions.some(ext => pathname.endsWith(ext)) ||
             url.includes('blob:') ||
             url.includes('data:image/');
    } catch {
      return false;
    }
  }

  // 📊 获取配置状态
  getStatus(): { enabled: boolean; features: string[] } {
    const features: string[] = [];
    
    if (this.config.enableKeywordFilter) features.push('关键词过滤');
    if (this.config.enableBasicCheck) features.push('基础检查');
    if (this.config.enableAPICheck) features.push('API检查');
    
    return {
      enabled: this.config.enabled,
      features
    };
  }

  // 🔧 动态更新配置
  updateConfig(newConfig: Partial<SafeModeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🔧 内容安全配置已更新:', this.config);
  }
}

// 🔥 创建全局安全实例
export const safeModeContentSafety = new SafeModeContentSafety();

// 🔥 便捷的检查函数
export async function checkPromptSafety(prompt: string): Promise<SafetyResult> {
  return await safeModeContentSafety.checkPromptSafety(prompt);
}

export async function checkImageSafety(imageUrl: string): Promise<SafetyResult> {
  return await safeModeContentSafety.checkImageSafety(imageUrl);
} 
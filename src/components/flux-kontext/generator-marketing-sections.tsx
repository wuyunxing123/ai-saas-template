"use client";

import {
  Edit,
  Image as ImageIcon,
  Layers,
  Lock,
  Settings,
  Upload,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GeneratorModelValue } from "@/components/flux-kontext/types";

interface GeneratorMarketingSectionsProps {
  selectedModel: GeneratorModelValue;
  availableModels: string[];
  onSelectModel: (value: GeneratorModelValue) => void;
  onUpgrade: () => void;
}

export function GeneratorMarketingSections({
  selectedModel,
  availableModels,
  onSelectModel,
  onUpgrade,
}: GeneratorMarketingSectionsProps) {
  const workflowSteps = [
    {
      title: "准备素材",
      description:
        "需要保持人物、风格或构图一致时，先放入参考图。",
      icon: Upload,
    },
    {
      title: "下达编辑指令",
      description:
        "用一句话写清想要的修改，而不是在零散控件里反复折腾。",
      icon: Edit,
    },
    {
      title: "生成并迭代",
      description:
        "按速度、成本与质量目标选择模型档位，再基于结果继续打磨。",
      icon: Zap,
    },
  ];

  const featureCards = [
    {
      title: "角色一致性",
      description:
        "更换场景、光线或构图时，保持人物、服装与轮廓稳定。",
      icon: Layers,
    },
    {
      title: "定向编辑",
      description:
        "无需为每个变体重写整套提示词，即可做精确修改。",
      icon: Settings,
    },
    {
      title: "参考驱动风格",
      description:
        "让新生成贴近已有视觉，而不是每次从零开始。",
      icon: ImageIcon,
    },
    {
      title: "快速迭代",
      description:
        "保持短反馈循环，调提示词像设计迭代，而不是排队等待。",
      icon: Zap,
    },
  ];

  const faqs = [
    {
      question: "Flux Kontext 最擅长什么？",
      answer:
        "需要带上下文的受控生成或编辑时最出色，尤其是参考图重要的场景。",
    },
    {
      question: "Pro 和 Max 怎么选？",
      answer:
        "Pro 是日常更快的主力；Max 成本更高，但在文字排版、提示词遵循与成品精修上更好。",
    },
    {
      question: "为什么控件做得克制？",
      answer:
        "因为小而精的控制面，通常比暴露所有开关的大面板产出更好。",
    },
  ];

  const modelCards = [
    {
      key: "pro" as const,
      title: "Pro 模型",
      credits: "16 积分",
      summary: "兼顾速度与质量，适合快速编辑与稳定迭代。",
      points: [
        "实验出图更快",
        "编辑与参考支持强",
        "日常生成的默认选择",
      ],
    },
    {
      key: "max" as const,
      title: "Max 模型",
      credits: "32 积分",
      summary: "更高成本的输出路径，适合更严格提示词与精修成品。",
      points: [
        "高压下提示词遵循更好",
        "文字与细节处理更强",
        "更适合高要求交付",
      ],
    },
  ];

  return (
    <>
      <section className="generator-section-frame generator-reveal mt-8 p-6 sm:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <span className="generator-kicker">更少的界面噪音</span>
            <h2 className="generator-heading mt-4 text-3xl font-semibold sm:text-4xl">
              更干净的生成与编辑工作流
            </h2>
            <p className="generator-subheading mt-3 max-w-2xl text-sm sm:text-base">
              目标不是更多旋钮，而是把上传、提示词与模型选择收进一条更专注的工作流。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.title}
                  className="generator-marketing-card p-5 text-left"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="generator-icon-orb generator-icon-orb--warm flex h-12 w-12 items-center justify-center">
                      <Icon className="generator-icon--warm h-5 w-5" />
                    </div>
                    <Badge
                      variant="outline"
                      className="generator-chip text-[11px]"
                    >
                      第 {index + 1} 步
                    </Badge>
                  </div>
                  <h3 className="generator-heading text-xl font-semibold">
                    {step.title}
                  </h3>
                  <p className="generator-copy mt-3 text-sm leading-6">
                    {step.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="generator-reveal mt-8 py-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <span className="generator-kicker">它真正擅长的事</span>
            <h2 className="generator-heading mt-4 text-3xl font-semibold sm:text-4xl">
              去掉营销话术的核心能力
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {featureCards.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="generator-marketing-card p-6 text-left"
                >
                  <div className="generator-icon-orb generator-icon-orb--cool mb-4 flex h-12 w-12 items-center justify-center">
                    <Icon className="generator-icon h-5 w-5" />
                  </div>
                  <h3 className="generator-heading text-xl font-semibold">
                    {feature.title}
                  </h3>
                  <p className="generator-copy mt-3 text-sm leading-6">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="generator-reveal mt-8 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <span className="generator-kicker">直接回答</span>
            <h2 className="generator-heading mt-4 text-3xl font-semibold sm:text-4xl">
              常见问题
            </h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <article
                key={faq.question}
                className="generator-marketing-card p-6"
              >
                <h3 className="generator-heading text-xl font-semibold">
                  {faq.question}
                </h3>
                <p className="generator-copy mt-3 text-sm leading-6">
                  {faq.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="generator-reveal mt-8 py-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <span className="generator-kicker">按工作流选择，而非噱头</span>
            <h2 className="generator-heading mt-4 text-3xl font-semibold sm:text-4xl">
              模型档位对应真实用途
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {modelCards.map((model) => {
              const isAvailable = availableModels.includes(model.key);
              const isSelected = selectedModel === model.key;

              return (
                <article
                  key={model.key}
                  className="generator-marketing-card flex h-full flex-col p-6"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="generator-heading text-2xl font-semibold">
                      {model.title}
                    </h3>
                    <Badge
                      variant="outline"
                      className={
                        model.key === "max"
                          ? "generator-chip generator-chip--warm"
                          : "generator-chip"
                      }
                    >
                      {model.credits}
                    </Badge>
                  </div>

                  <p className="generator-copy mb-6 text-sm leading-6">
                    {model.summary}
                  </p>

                  <ul className="mb-6 flex-1 space-y-3">
                    {model.points.map((point) => (
                      <li key={point} className="flex items-start gap-3">
                        <span className="generator-status-dot mt-2" />
                        <span className="generator-copy text-sm">{point}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant="outline"
                    className={
                      isSelected
                        ? "generator-primary-button w-full"
                        : "generator-secondary-button w-full"
                    }
                    onClick={() => {
                      if (!isAvailable) {
                        onUpgrade();
                        return;
                      }
                      onSelectModel(model.key);
                    }}
                  >
                    {!isAvailable ? (
                      <>
                        <Lock className="mr-2 h-4 w-4" />
                        需要升级
                      </>
                    ) : isSelected ? (
                      "已选择"
                    ) : (
                      `选择${model.title}`
                    )}
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

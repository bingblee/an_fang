export const categoryIds = ["work", "life", "shopping", "relationship", "personal", "other"] as const;
export type CategoryId = typeof categoryIds[number];

export const categoryLabels: Record<CategoryId, string> = {
  work: "工作", life: "生活", shopping: "购物", relationship: "人际", personal: "个人", other: "其他"
};

export const categoryDescriptions: Record<CategoryId, string> = {
  work: "跨项目查看工作、会议与交付事项。",
  life: "家务、出行和日常生活中的小事。",
  shopping: "要买、要补货、要准备的东西，一起查看。",
  relationship: "与家人、朋友和重要的人有关的事。",
  personal: "留给自己的学习、习惯和个人安排。",
  other: "暂时不属于其他分类的事项。"
};

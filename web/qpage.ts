import type { IPageMeta, ISection, IQPageConfig } from "qpage";

export const config: IQPageConfig = {
  defaultLang: "zh-Hans",
  siteOrigin: "https://qzrzz.github.io/JuRename",
};

import UrlIcon from "./assets/jurename-icon.png";
import UrlIconFull from "./icons/icon-full.png";
import UrlMainScreenshotImage from "./assets/jurename-screenshot-preview.png";

const screenshotStart = "./assets/jurename-screenshot-start.png";
const screenshotDone = "./assets/jurename-screenshot-done.png";

export const page: IPageMeta = {
  productTitle: "JuRename",
  productTitleCN: "剧集文件批量重命名",
  tagline: "识别连续序号，批量重命名剧集、有声书等需要顺序的文件",
  taglineShort: "智能识别连续序号的批量文件重命名工具",
  icon: UrlIcon,
  iconFull: UrlIconFull,
  platforms: ["macos", "windows", "linux"],
  metaDesc:
    "JuRename 是一个免费开源的批量重命名工具，从杂乱文件名中识别连续序号，补零并批量整理剧集、播客和有声书文件。",
  githubRepo: "https://github.com/Qzrzz/JuRename",
  onlineUrl: "https://qzrzz.com/JuRename/",
  downloadBase: "https://download.qzrzz.com/JuRename",
  mainScreenshotImage: UrlMainScreenshotImage,
};

export const sections: ISection[] = [
  {
    id: "why",
    title: "什么时候需要 JuRename",
    description:
      "剧集、有声书等文件在各个软件和设备中需要正确的顺序，但文件名可能并不规范，导致排序不正确，这时就需要一个工具能正确识别文件序号，给文件按规范重命名",
    cards: [{ image: "./assets/s1.png", style: "center" }],
  },

  {
    id: "features",
    isNav: true,
    title: "JuRename 能做什么",
    description:
      "JuRename 可以批量给文件按正确的序号重命名，它会智能的从现有文件名中识别可信的连续序号，让混乱规则的剧集文件名按有正确的顺序",
    cards: [
      {
        title: "识别真正的序号",
        desc: "不依赖“第几集”等固定关键词，可以从整个列表分析，识别出真正的序号。\n即使是阿拉伯数字和中文数字同时混用也可以正确判断",
        image: "./assets/s4.png",
        style: "center",
      },

      {
        title: "批量给文件名添加序号",
        desc: "自动补零对齐的序号，让文件在任何音乐播放器、播放列表、文件管理器能正确排序",
        image: screenshotDone,
        style: "center",
      },
      {
        title: "缺集，一眼可见",
        desc: "序号不连续时自动标出缺失区间；同时支持 001.1 一类子序号，让长篇剧集、播客和有声书更容易整理。",
        image: "./assets/s2.png",
        style: "center",
      },

      {
        title: "多文件夹分析",
        desc: "拖入父级文件夹，同时分析多个子文件夹中的文件，可以找到哪些文件夹缺少哪些具体集数",
        image: "./assets/s3.png",
        style: "center",
      },
    ],
  },
  {
    id: "screenshots",
    title: "每一步，都不用考虑太多",
    description:
      "从导入文件到完成重命名，无需思考什么是正则表达式、什么是通配符，一键完成，无需思考。",
    cards: [
      {
        image: screenshotStart,
        style: "center",
      },
    ],
  },
];

import { IPageMeta, ISection, IQPageConfig } from "qpage";

export const config: IQPageConfig = {
  defaultLang: "zh-Hans",
};

import UrlIcon from "./icons/qcopy-icon.png";
import UrlIconFull from "./icons/qcopy-icon-full.png";

import UrlMainScreenshotImage from "./assets/s1.png";

export const page: IPageMeta = {
  productTitle: "JuRename",
  productTitleCN: "快速复制文件",
  tagline: "macOS 文件复制工具。海量小文件、外置磁盘与 NAS 也能快速复制",
  taglineShort: "海量小文件复制工具",
  icon: UrlIcon,
  iconFull: UrlIconFull,
  platforms: ["macos"],
  metaDesc: "macOS 文件复制工具。海量小文件、外置磁盘与 NAS 也能快速复制，FastCopy macOS 版本",
  githubRepo: "https://github.com/qzrzz/QCopy",

  mainScreenshotImage: UrlMainScreenshotImage,
};

export const sections: ISection[] = [
  {
    id: "why",
    title: "为什么选择 QCopy",
    isNav: true,
    description:
      "要把成千上万小文件拷到 NAS 或外置磁盘？不必再卡在「正在准备移动…」。\n如果你用过 Windows 上的 FastCopy / Robocopy，可以把 QCopy 当作 macOS 上的同类工具。",
    cards: [{ style: "center", image: "./assets/macosReady.png" }],
  },

  {
    id: "features",

    cards: [
      {
        title: "复制与移动",
        desc: "简单的复制 / 移动。跳过冗长的预拷贝准备，并提供清晰进度，海量小文件传输更快。",
        style: "center",
        image: "./assets/s1.png",
      },

      {
        title: "传输信息图表",
        desc: "可以显示复制时传输详细信息。",
        style: "center",
        image: "./assets/s2.png",
      },

      {
        title: "复制记录",
        desc: "完整保留每一次传输的详细记录。",
        style: "center",
        image: "./assets/s3.png",
      },
    ],
  },
];

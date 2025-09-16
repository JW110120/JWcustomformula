// 创建样式表
const createThemeStyles = () => {
  const style = document.createElement('style');
  document.head.appendChild(style);
  
  style.textContent = `
    :root {
        --bg: #181818;
        --button-bg: rgb(50, 50, 50);
        --bg-sb: rgb(50, 50, 50);
        --bg-hover: rgba(38, 128, 235, 0.1);
        --button-bg-hover: rgba(38, 128, 235, 0.1);
        --text: rgb(214,214, 214);
        --text-hover: rgb(214,214, 214);
        --text-selected: rgb(235, 235, 235);
        --gear: rgb(214,214, 214);
        --gear-selected: rgb(214,214, 214);
        --icon: rgb(214,214, 214);
        --icon-hover: rgb(214,214, 214);
        --border: #484848;
        --text-sb: #848484;
        --REC-icon: #e01b1b;
        --bg-selected: #404040;
    }

    @media (prefers-color-scheme: darkest) {
      :root {
        --bg:rgb(24, 24, 24);
        --button-bg: rgb(50, 50, 50);
        --bg-sb: rgb(50, 50, 50);
        --bg-hover: rgba(38, 128, 235, 0.1);
        --button-bg-hover: rgba(38, 128, 235, 0.1);
        --text: rgb(214,214, 214);
        --text-hover: rgb(214,214, 214);
        --text-selected: rgb(235, 235, 235);
        --gear: rgb(214,214, 214);
        --gear-selected: rgb(214,214, 214);
        --icon: rgb(214,214, 214);
        --icon-hover: rgb(214,214, 214);
        --border: #484848;
        --text-sb: #848484;
        --REC-icon: #e01b1b;
        --bg-selected: #404040;
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: rgb(55, 55, 55);
        --button-bg: rgb(80, 80, 80);
        --bg-sb: rgb(80, 80, 80);
        --bg-hover: rgba(38, 128, 235, 0.1);
        --button-bg-hover: rgba(38, 128, 235, 0.1);
        --text: rgb(215, 215, 215);
        --text-hover: rgb(215, 215, 215);
        --text-selected: rgb(235, 235, 235);
        --gear: rgb(215, 215, 215);
        --gear-selected: rgb(215, 215, 215);
        --icon: rgb(215, 215, 215);
        --icon-hover: rgb(215, 215, 215);
        --border: #555555;
        --text-sb: #999999;
        --REC-icon: #e01b1b;
        --bg-selected: #707070;     
      }
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: rgb(209, 209, 209);
        --button-bg: rgb(184,184, 184);
        --bg-sb: rgb(184,184, 184);
        --bg-hover: rgba(38, 128, 235, 0.1);
        --button-bg-hover: rgba(38, 128, 235, 0.1);
        --text: rgb(37,37,37);
        --text-hover: rgb(37,37,37);
        --text-selected: rgb(235, 235, 235);
        --gear: rgb(37,37,37);
        --gear-selected: rgb(37,37,37);
        --icon: rgb(37,37,37);
        --icon-hover: rgb(37,37,37);
        --border: #a0a0a0;
        --text-sb: #666666;
        --REC-icon: #e01b1b;
        --bg-selected: #999999;
      }
    }

    @media (prefers-color-scheme: lightest) {
      :root {
        --bg: rgb(252, 252, 252);
        --button-bg: rgb(240, 240, 240);
        --bg-sb: rgb(240, 240, 240);
        --bg-hover: rgba(38, 128, 235, 0.1);
        --button-bg-hover: rgba(38, 128, 235, 0.1);
        --text: rgb(48, 48, 48);
        --text-hover: rgb(48, 48, 48);
        --text-selected: rgb(235, 235, 235);
        --gear: rgb(48, 48, 48);
        --gear-selected: rgb(48, 48, 48);
        --icon: rgb(48, 48, 48);
        --icon-hover: rgb(48, 48, 48);
        --border: #c4c4c4;
        --text-sb: #909090;
        --REC-icon: #e01b1b;
        --bg-selected: #b0b0b0;
      }
    }
  `;
};

export const initializeTheme = () => {
  // UXP 环境 polyfill：部分宿主缺失 window.screen/matchMedia，导致 React Spectrum 移动端探测崩溃
  if (typeof window !== 'undefined') {
    const w = window as any;
    if (typeof w.screen === 'undefined') {
      w.screen = {
        width: 1024,
        height: 768,
        availWidth: 1024,
        availHeight: 768,
        colorDepth: 24,
        pixelDepth: 24,
        orientation: { type: 'landscape-primary', angle: 0 }
      };
    }
    if (typeof w.matchMedia !== 'function') {
      w.matchMedia = () => ({
        matches: false,
        media: '',
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        onchange: null,
        dispatchEvent() { return false; }
      });
    }
  }
  createThemeStyles();
};

// 主题变量定义
export const themes = {
  default: `
  :root {
    --bg: #1e1e1e;
    --text: #e0e0e0;
    --text-secondary: #b0b0b0;
    --border: #2a2a2a;
    --bg-hover: #2a2a2a;
    --bg-selected: #404040;
    --text-selected: #ffffff;
    --gear: #a0a0a0;
    --gear-selected: #ffffff;
    --accent: #2680EB;
  }
  `,
  darkest: `
  .theme-darkest {
    --bg: #121212;
    --text: #e0e0e0;
    --text-secondary: #9a9a9a;
    --border: #1f1f1f;
    --bg-hover: #1e1e1e;
    --bg-selected: #404040;
    --text-selected: #ffffff;
    --gear: #8a8a8a;
    --gear-selected: #ffffff;
    --accent: #2680EB;
  }
  `,
  dark: `
  .theme-dark {
    --bg: #222222;
    --text: #e6e6e6;
    --text-secondary: #bdbdbd;
    --border: #2a2a2a;
    --bg-hover: #2c2c2c;
    --bg-selected: #707070;
    --text-selected: #ffffff;
    --gear: #aaaaaa;
    --gear-selected: #ffffff;
    --accent: #2680EB;
  }
  `,
  light: `
  .theme-light {
    --bg: #fafafa;
    --text: #222222;
    --text-secondary: #444444;
    --border: #e1e1e1;
    --bg-hover: #f0f0f0;
    --bg-selected: #999999;
    --text-selected: #ffffff;
    --gear: #666666;
    --gear-selected: #222222;
    --accent: #2680EB;
  }
  `,
  lightest: `
  .theme-lightest {
    --bg: #ffffff;
    --text: #1a1a1a;
    --text-secondary: #333333;
    --border: #e6e6e6;
    --bg-hover: #f5f5f5;
    --bg-selected: #b0b0b0;
    --text-selected: #ffffff;
    --gear: #555555;
    --gear-selected: #222222;
    --accent: #2680EB;
  }
  `
};
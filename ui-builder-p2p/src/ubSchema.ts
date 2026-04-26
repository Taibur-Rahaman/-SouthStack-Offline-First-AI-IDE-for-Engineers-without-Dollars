export const ROOT_ID = 'root';

export type UbElementType = 'section' | 'column' | 'row' | 'button' | 'image' | 'text' | 'icon';

export type DeviceView = 'desktop' | 'mobile';
export type ResponsiveNumber = number | string | { desktop?: number | string; mobile?: number | string };

export type UbStyle = Record<string, string | number | undefined>;

export type UbElementJson = {
  id: string;
  type: UbElementType;
  content?: string;
  src?: string;
  style?: UbStyle;
  children?: string[];
};

export type UIElement = UbElementJson & {
  width?: ResponsiveNumber;
  height?: ResponsiveNumber;
};

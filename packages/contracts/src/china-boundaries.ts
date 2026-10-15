import { z } from 'zod';

export const chinaBoundarySettingsSchema = z
  .object({
    suzhouPark: z.boolean(),
    huzhongXinlin: z.boolean(),
    jiagedaqi: z.boolean(),
    songling: z.boolean(),
    shenshan: z.boolean(),
    lianjiang: z.boolean().default(false),
    jinmen: z.boolean().default(false),
    tanggulaTibet: z.boolean().default(false),
  })
  .strict();
export type ChinaBoundarySettings = z.infer<typeof chinaBoundarySettingsSchema>;
export const DEFAULT_CHINA_BOUNDARIES: ChinaBoundarySettings = {
  suzhouPark: true,
  huzhongXinlin: true,
  jiagedaqi: true,
  songling: true,
  shenshan: true,
  lianjiang: false,
  jinmen: false,
  tanggulaTibet: false,
};
export const CHINA_BOUNDARY_OPTIONS = [
  {
    key: 'suzhouPark',
    name: '苏州工业园区',
    off: '并入虎丘区',
    ids: ['CN900012'],
    target: 'CN320505',
  },
  {
    key: 'huzhongXinlin',
    name: '呼中区、新林区',
    off: '并入呼玛县',
    ids: ['CN900004', 'CN900003'],
    target: 'CN232721',
  },
  {
    key: 'jiagedaqi',
    name: '加格达奇区',
    off: '并入鄂伦春自治旗',
    ids: ['CN900001'],
    target: 'CN150723',
  },
  {
    key: 'songling',
    name: '松岭区',
    off: '并入鄂伦春自治旗',
    ids: ['CN900002'],
    target: 'CN150723',
  },
  {
    key: 'shenshan',
    name: '深汕特别合作区',
    off: '并入海丰县',
    ids: ['CN900013'],
    target: 'CN441521',
  },
  {
    key: 'lianjiang',
    name: '連江縣',
    off: '归属福州市连江县',
    ids: ['CN900014'],
    target: 'CN350122',
  },
  {
    key: 'jinmen',
    name: '金门縣',
    on: '金门、乌丘、东碇合并显示',
    off: '按现有金门县归属',
    ids: ['CN900015'],
    target: 'CN350527',
    hiddenWhenEnabled: ['CN350527'],
    enabledTarget: 'CN900015',
  },
  {
    key: 'tanggulaTibet',
    name: '唐古拉山镇西藏管理区',
    on: '归属安多、聂荣、巴青；名义界保留为虚线',
    off: '保留青海名义边界',
    ids: [],
    target: 'CN630000',
  },
] as const;

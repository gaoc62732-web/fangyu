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
    ids: ['2f8d5433-9bdc-5270-8535-9b039418a7ed'],
    target: 'a74c146e-520f-526d-a0de-4d2b86f87efa',
  },
  {
    key: 'huzhongXinlin',
    name: '呼中区、新林区',
    off: '并入呼玛县',
    ids: ['1a54e6b6-4807-533c-ab87-a2aafbc60fb1', '2032ab7d-e59a-5117-a8c8-29774fa9778e'],
    target: '7e71097a-dfd4-5306-aca8-3f5ae22d20ab',
  },
  {
    key: 'jiagedaqi',
    name: '加格达奇区',
    off: '并入鄂伦春自治旗',
    ids: ['1f120ca5-1aa7-54f2-ac79-2a9b1e114305'],
    target: '75677b37-67cd-527f-a2c0-c4337d5660aa',
  },
  {
    key: 'songling',
    name: '松岭区',
    off: '并入鄂伦春自治旗',
    ids: ['6f431f37-f107-574a-ae3d-8b35f18f37cf'],
    target: '75677b37-67cd-527f-a2c0-c4337d5660aa',
  },
  {
    key: 'shenshan',
    name: '深汕特别合作区',
    off: '并入海丰县',
    ids: ['63303d7c-feab-5c13-805d-a2d47fd5987f'],
    target: '6fae6668-f1b0-59d9-ae82-85a5852ce2b7',
  },
  {
    key: 'lianjiang',
    name: '連江縣',
    off: '归属福州市连江县',
    ids: ['ba6e088d-b7f6-53e2-8e9f-42f24a12f15c'],
    target: '3c406cfe-1ad0-5d78-ab6e-f3007263595f',
  },
  {
    key: 'jinmen',
    name: '金门縣',
    on: '金门、乌丘、东碇合并显示',
    off: '按现有金门县归属',
    ids: ['0190cea0-112e-5aba-9229-1be1967b3ef5'],
    target: '1aef0488-c062-5218-af18-5ab218bf963d',
    hiddenWhenEnabled: ['1aef0488-c062-5218-af18-5ab218bf963d'],
    enabledTarget: '0190cea0-112e-5aba-9229-1be1967b3ef5',
  },
  {
    key: 'tanggulaTibet',
    name: '唐古拉山镇西藏管理区',
    on: '归属安多、聂荣、巴青；名义界保留为虚线',
    off: '保留青海名义边界',
    ids: [],
    target: 'a53a9e7d-1100-5885-af0d-9134b30014ae',
  },
] as const;

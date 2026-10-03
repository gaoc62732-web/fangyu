/** Historical subject dates, not acquisition/unlock dates. No record or target data. */
export interface AchievementChronology {
  kind: 'dated' | 'legendary' | 'undated';
  label: string;
  startYear?: number;
  endYear?: number;
  basis: string;
  sources: readonly { title: string; url: string }[];
}
const chronology = {
  title: '中国历史纪年简表（中国政府网，中联办转载）',
  url: 'https://www.locpg.gov.cn/zggq/2014-01/04/c_125956418.htm',
};
const source = (title: string, url: string) => ({ title, url });
const dated = (
  label: string,
  startYear: number,
  endYear: number,
  basis: string,
  sources: AchievementChronology['sources'] = [chronology],
): AchievementChronology => ({ kind: 'dated', label, startYear, endYear, basis, sources });
const poem = source(
  '静宁县地方志：红军长征过静宁（附《七律·长征》及1935年题年）',
  'https://www.gsjn.gov.cn/zjjn/jnfz/art/2022/art_f50ab4aff934446c8967070a69859278.html',
);

// Negative years denote BCE; there is no year zero. Dynasty spans are explicit
// coarse ordering intervals, never claims that every target dates to both ends.
export const ACHIEVEMENT_CHRONOLOGY: Readonly<Record<string, AchievementChronology>> = {
  'theme-yu': {
    kind: 'legendary',
    label: '上古传说 · 无确年',
    basis:
      '按禹的上古传说主题置于已定年主题之前，不给传说编造公历年，也不认定九个现代目标为古九州治所。',
    sources: [
      source(
        '中国国家博物馆：夏商西周时期',
        'https://www.chnmuseum.cn/portals/0/web/zt/gudai/detail2.html',
      ),
      source(
        '中国国家博物馆：顾颉刚夏史研究与夏文化早期探索',
        'https://www.chnmuseum.cn/yj/xscg/xslw/201812/t20181224_36480.shtml',
      ),
    ],
  },
  'theme-shang': dated(
    '商 · 约前1600—前1046年',
    -1600,
    -1046,
    '沿用目录明确的商代都邑主题；以朝代范围排序，不替未核实迁都地望确定年代。',
  ),
  'theme-hegemons': dated(
    '春秋 · 前770—前476年',
    -770,
    -476,
    '七国目标属于春秋争霸主题，使用春秋分期范围；不声称七位霸主同时在位。',
  ),
  'theme-seven': dated(
    '战国 · 前475—前221年',
    -475,
    -221,
    '使用战国分期范围，不以现代城市设立时间排序。',
  ),
  'theme-qin': dated(
    '秦 · 前221—前207年',
    -221,
    -207,
    '目录为秦始皇刻石主题，使用秦朝范围；不把这一范围当作七篇刻石逐篇确年。',
  ),
  'theme-chu-han': dated(
    '楚汉相争 · 前206—前202年',
    -206,
    -202,
    '按楚汉相争的历史事件区间，不取现代遗址发现或到访时间。',
    [
      source(
        '江苏省地方志：汉文化的生成与影响',
        'https://jssdfz.jiangsu.gov.cn/n95/20240704/i34356.html',
      ),
    ],
  ),
  'theme-han-tombs': dated(
    '西汉 · 前202—公元8年',
    -202,
    8,
    '目录明确为西汉十一帝陵，以西汉王朝范围粗排；不代表各陵同年修建或下葬。',
  ),
  'theme-rebellion': dated('七国之乱 · 前154年', -154, -154, '按汉景帝三年事件年份。', [
    source(
      '农业农村部：廉政文化（《淮南子》史事）',
      'https://jcj.moa.gov.cn/lzwh/201402/t20140213_3762276.htm',
    ),
  ]),
  'theme-han103': dated(
    '西汉末 · 约前12—公元2年',
    -12,
    2,
    '《汉书·地理志》混合成帝元延、绥和时版图与平帝元始二年户籍。起点取元延时期的宽界，不能解释为全部郡国同年设置或已核齐103项。',
    [
      source(
        '全国哲社办：李晓杰谈《汉书·地理志》资料年代',
        'https://www.nopss.gov.cn/n1/2023/0823/c448861-40062310.html',
      ),
      source(
        '复旦大学历史地名数据库：元延纪年换算',
        'https://tgaz.fudan.edu.cn/tgaz/placename/hvd_82120',
      ),
      source(
        '复旦大学历史地名数据库：元始二年为公元2年',
        'https://tgaz.fudan.edu.cn/tgaz/placename/hvd_43714',
      ),
    ],
  ),
  'theme-guangwu': dated(
    '光武中兴 · 25—57年',
    25,
    57,
    '采用官方资料所列光武帝在位时期的中兴主题范围。',
    [
      source(
        '中央纪委网站：公元20年代——光武中兴',
        'https://m.ccdi.gov.cn/content/41/a8/57067.html',
      ),
    ],
  ),
  'theme-chancellor': dated(
    '诸葛亮主题 · 181—234年',
    181,
    234,
    '目录以武侯祠为主题，按所纪念人物诸葛亮生卒范围排序；不取杜甫诗作或现存祠堂重建年代。',
    [source('南阳市政府：诸葛亮', 'https://www.nanyang.gov.cn/2020/07-06/295653.html')],
  ),
  'theme-three': dated(
    '官渡至夷陵 · 200—222年',
    200,
    222,
    '目录明确列官渡、赤壁、夷陵，按三战最早与最晚年份排序（200、208、222）。',
    [
      source(
        '武汉经开区：赤壁之战与军山（三战纪年）',
        'https://www.whkfq.gov.cn/xwzx/yw/kfqyw/qnxw/202206/t20220618_1989688.html',
      ),
    ],
  ),
  'theme-grass': dated(
    '淝水之战 · 383年',
    383,
    383,
    '八公山官方介绍将草木皆兵所关联淝水之战记为383年。',
    [source('八公山区政府：淝水之战', 'https://www.bagongshan.gov.cn/whly/bgsfg/8108626.html')],
  ),
  'theme-foli': dated(
    '北魏屯兵瓜步 · 450—451年',
    450,
    451,
    '按拓跋焘屯兵瓜步的事件，不按辛弃疾词作或后来祠庙年代。六合旧诗注出现明显误纪年，采用南京地方志450年十二月至451年正月记述。',
    [
      source(
        '南京市地方志：六合风云——驰骋疆场的历代帝王',
        'https://dfz.nanjing.gov.cn/gzdt/202605/t20260522_5844870.html',
      ),
    ],
  ),
  'theme-tang': dated(
    '唐 · 618—907年',
    618,
    907,
    '采用目录明确的唐代都城、陪都及行在主题朝代范围。',
  ),
  'theme-emei': dated(
    '《峨眉山月歌》 · 725年',
    725,
    725,
    '采用官方文化文章所列李白离蜀作诗年份；诗中地望异说仍按原目录保留。',
    [
      source(
        '贵州政协报：李白的月亮',
        'https://www.gzszx.gov.cn/gzzxb/web/doc/detail/d_1714103684956192',
      ),
    ],
  ),
  'theme-yuyang': dated(
    '安史之乱 · 755—763年',
    755,
    763,
    '按渔阳起兵及安史之乱事件区间；不按题句所在诗篇的成书年代。',
    [
      source(
        '临湘市政府：从《资治通鉴》观察柳宗元',
        'https://www.linxiang.gov.cn/24733/24760/24821/24992/24999/content_1841067.html',
      ),
    ],
  ),
  'theme-ten': dated(
    '五代十国 · 907—979年',
    907,
    979,
    '采用官方纪年简表的时期范围；个别政权前身早于907年，不以此认定所有政权同时开始。',
  ),
  'theme-outlaws': dated(
    '北宋末 · 文学故事背景',
    960,
    1127,
    '按《水浒传》的北宋故事背景归入北宋范围（960—1127），不是说故事从960年开始，也不是按元末明初成书时间；尚未逐回确定统一精确起年。',
    [
      source(
        '济宁市文旅局：水浒文化旅游区简介',
        'https://whlyj.jining.gov.cn/art/2020/4/30/art_32546_2489422.html',
      ),
      chronology,
    ],
  ),
  'theme-loushan': dated(
    '娄山关战斗 · 1935年',
    1935,
    1935,
    '按目录所指红军娄山关战斗，年份精度排序；同年主题保留目录先后，不伪造月份排序。',
    [
      source(
        '广西政协党史学习：雄关漫道真如铁',
        'https://www.gxzx.gov.cn/index.php?a=show&c=index&id=3096&m=special',
      ),
    ],
  ),
  'theme-liupan': dated(
    '红军翻越六盘山 · 1935年',
    1935,
    1935,
    '按中央红军翻越六盘山事件年份，不取纪念馆建馆年。',
    [
      source(
        '国家民委：宁夏六盘山红军纪念馆',
        'https://www.neac.gov.cn/seac/c103547/202111/1155252.shtml',
      ),
    ],
  ),
  'theme-wuling': dated(
    '《七律·长征》主题 · 1935年',
    1935,
    1935,
    '以官方刊载原诗“ 五岭逶迤 ”对应的1935年诗词主题作为排序依据，不声称山脉形成于此年或已经核齐县域；原暂缓解锁条件不变。',
    [poem],
  ),
  'theme-wumeng': dated(
    '《七律·长征》主题 · 1935年',
    1935,
    1935,
    '以官方刊载原诗“ 乌蒙磅礴 ”对应的1935年诗词主题排序；38县的现代规划仅是目标判定范围，不以规划发布年作为历史年代。',
    [poem],
  ),
  'theme-bamboo': {
    kind: 'undated',
    label: '跨时代简牍 · 年代待核',
    basis:
      '现有六处简牍目标不能直接归于同一历史事件。未逐一核定资料年代及统一排序起点，置于已定年主题之后；不以现代发现年份或标题猜定汉代。',
    sources: [],
  },
};

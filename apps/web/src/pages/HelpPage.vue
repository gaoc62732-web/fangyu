<script setup lang="ts">
import { useAppStore } from '../app/store.js';
const store = useAppStore();
</script>

<template>
  <section class="page-heading"><h2>使用说明与资料范围</h2></section>
  <article class="card prose">
    <h3>记录规则</h3>
    <p>
      未到达、飞跃、途经、到达、短居、居住构成六级状态。到达及以上计入政区成就。勾选项目会补记其所属地区及父级到达；取消项目不会自动撤销政区状态。手动降低政区状态保留项目和下辖地区记录。
    </p>
    <p>
      组成项目可单独勾选，部分到访以方框的中间态显示。名称与备注是个人记录，不修改公共目录。空类别可添加个人项目。
    </p>
    <h3>导入</h3>
    <p>
      名称清单支持按地区限定同名项目；机场可按代码或别名匹配。Railtrack
      只将线路中列明的车站所属县区记为途经，起终点车站作为乘降候选。所有候选均可在预览中调整。
    </p>
    <p>
      KML 接受点、线和轨迹。OSM XML/PBF
      必须先选择地图要素，地理数据本身不自动表示到访。照片仅读取内嵌 GPS，原始图片不上传；无
      GPS、边界歧义和坐标基准异常会列入核对结果。
    </p>
    <p>
      Excel 使用新版“地区记录”和“项目记录”工作表，以实体 ID 关联。JSON
      采用当前结构化记录格式。开发阶段不导入旧版 HTML、单元格 JSON 或旧版 Excel 模板。
    </p>
    <h3>资料范围</h3>
    <p>
      目录版本：{{
        store.session!.index.catalog.version
      }}。中国历史政区与现行政区分开统计；港澳下级政区资料不完整，全国制霸成就仍暂缓。卯分按原手册口径计算，不将未收录地区默认为已完成。
    </p>
    <p>
      日本含 47 个都道府县、JR
      与其他轨道站、机场、世界遗产、已核定地点的国宝和特别史迹。未核定长期保存地点的国宝不计入府县。韩国专题按现有
      16 地区目录展示；部分地点仅有目录记录，没有坐标。
    </p>
    <p>
      世界主成就使用当前手册的国家／地区统计口径，特殊图层不计入主计数。跨国世界遗产按 UNESCO
      编号去重；统计分组不表达政治地位判断。
    </p>
    <p>
      底图为资料展示与旅行记录使用，边界、代表点和空间匹配存在精度限制。成就的详细目标、来源和暂缓理由可在对应卡片展开查看。
    </p>
    <p>
      世界遗产基础字段来自 UNESCO DataHub（2026-09-19 版本，CC BY-SA 4.0）。Copyright © 1992–2026
      UNESCO/World Heritage Centre. All rights reserved.
      中国与世界底图沿用原项目数据，两江新区边界采用近似范围。
    </p>
    <details>
      <summary>目录来源清单</summary>
      <pre>{{ JSON.stringify(store.session!.index.catalog.sources, null, 2) }}</pre>
    </details>
  </article>
</template>

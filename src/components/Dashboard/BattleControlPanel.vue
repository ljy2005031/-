<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useBattleControlStore } from '@/store/modules/battle_control'

const battleControlStore = useBattleControlStore()

const redControl = computed(() => battleControlStore.redControl)
const blueControl = computed(() => battleControlStore.blueControl)
const redRate = computed(() => battleControlStore.redRate)
const blueRate = computed(() => battleControlStore.blueRate)
const diff = computed(() => battleControlStore.diff)

onMounted(() => {
  battleControlStore.startTimer()
})

onUnmounted(() => {
  battleControlStore.stopTimer()
})
</script>

<template>
  <div class="battle-control-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="title-dot"></span>
        战场控制度
      </div>
      <span class="panel-subtitle">BATTLE CONTROL</span>
    </div>

    <div class="battle-row">
      <div class="team-card red">
        <span class="team-label">红方控制度</span>
        <div class="team-value-row">
          <strong class="team-value">{{ redControl }}</strong>
          <span class="team-rate">+{{ redRate }}/s</span>
        </div>
      </div>

      <div class="delta-card" :class="{ 'is-leading': diff > 0 }">
        <span class="delta-label">差值</span>
        <strong class="delta-value">{{ diff > 0 ? `+${diff}` : diff }}</strong>
      </div>

      <div class="team-card blue">
        <span class="team-label">蓝方控制度</span>
        <div class="team-value-row">
          <strong class="team-value">{{ blueControl }}</strong>
          <span class="team-rate">+{{ blueRate }}/s</span>
        </div>
      </div>
    </div>

    <div
      class="control-track"
      :class="{ 'is-empty': redControl + blueControl === 0 }"
    >
      <span
        class="control-fill red"
        :style="{
          width: `${redControl + blueControl > 0 ? (redControl / (redControl + blueControl)) * 100 : 50}%`
        }"
      ></span>
      <span class="control-fill blue"></span>
    </div>
  </div>
</template>

<style scoped>
.battle-control-panel {
  box-sizing: border-box;
  position: fixed;
  left: 50%;
  top: 16px;
  z-index: 9998;
  width: min(680px, calc(100vw - 40px));
  transform: translateX(-50%);
  padding: 12px 18px 11px;
  border: 1px solid rgba(56, 189, 248, 0.38);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(20, 29, 40, 0.96), rgba(7, 13, 21, 0.93));
  color: #f8fafc;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  backdrop-filter: blur(10px);
  box-shadow:
    0 0 0 1px rgba(56, 189, 248, 0.08),
    0 10px 30px rgba(0, 0, 0, 0.55),
    0 0 24px rgba(56, 189, 248, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: none;
  white-space: nowrap;
}

.battle-control-panel::before,
.battle-control-panel::after {
  content: '';
  position: absolute;
  height: 2px;
  width: 82px;
  pointer-events: none;
}

.battle-control-panel::before {
  top: -1px;
  left: 14px;
  background: linear-gradient(90deg, transparent, #38bdf8);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.85);
}

.battle-control-panel::after {
  right: 14px;
  bottom: -1px;
  background: linear-gradient(90deg, #38bdf8, transparent);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.85);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #dbeafe;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.panel-subtitle {
  color: rgba(56, 189, 248, 0.48);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.22em;
}

.title-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.9);
}

.battle-row {
  display: flex;
  align-items: stretch;
}

.team-card {
  flex: 1;
  min-width: 0;
  padding: 8px 14px 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}

.team-card.red {
  border-color: rgba(255, 90, 111, 0.38);
  background: linear-gradient(
    135deg,
    rgba(255, 90, 111, 0.14),
    rgba(255, 90, 111, 0.03)
  );
  box-shadow: inset 0 0 18px rgba(255, 90, 111, 0.08);
}

.team-card.blue {
  border-color: rgba(78, 168, 255, 0.38);
  background: linear-gradient(
    135deg,
    rgba(78, 168, 255, 0.14),
    rgba(78, 168, 255, 0.03)
  );
  box-shadow: inset 0 0 18px rgba(78, 168, 255, 0.08);
}

.team-label {
  display: block;
  margin-bottom: 3px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.team-value-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.team-value {
  font-size: 27px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.team-card.red .team-value {
  color: #ff5a6f;
  text-shadow: 0 0 12px rgba(255, 90, 111, 0.55);
}

.team-card.blue .team-value {
  color: #4ea8ff;
  text-shadow: 0 0 12px rgba(78, 168, 255, 0.55);
}

.team-rate {
  color: rgba(255, 255, 255, 0.52);
  font-size: 11px;
  font-weight: 700;
}

.delta-card {
  flex: 0 0 112px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-left: 1px solid rgba(56, 189, 248, 0.3);
  border-right: 1px solid rgba(56, 189, 248, 0.3);
}

.delta-label {
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
}

.delta-value {
  color: rgba(255, 255, 255, 0.9);
  font-size: 23px;
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.delta-card.is-leading .delta-value {
  color: #facc15;
  text-shadow: 0 0 14px rgba(250, 204, 21, 0.75);
}

.control-track {
  display: flex;
  width: 100%;
  height: 4px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.55);
}

.control-fill {
  display: block;
  height: 100%;
}

.control-fill.red {
  background: linear-gradient(90deg, #b91c1c, #ff5a6f);
  box-shadow: 0 0 10px rgba(255, 90, 111, 0.8);
}

.control-fill.blue {
  flex: 1;
  background: linear-gradient(90deg, #4ea8ff, #1d4ed8);
  box-shadow: 0 0 10px rgba(78, 168, 255, 0.8);
}

.control-track.is-empty .control-fill {
  opacity: 0.2;
}
</style>
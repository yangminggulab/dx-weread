const { diaryDateLabel } = require('../../utils/date-label')
Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    entry: { type: Object, value: {} },
    status: { type: String, value: 'loading' },
    automatic: { type: Boolean, value: false },
    saving: { type: Boolean, value: false },
    conflict: { type: Object, value: null }
  },
  data: {
    editing: false,
    dateTitle: '今天', dateSubtitle: '',
    labels: {
      error: '暂时无法连接云端，草稿已保留，会自动重试',
      'storage-error': '本机草稿未能保存，请保持页面打开并重试'
    }
  },
  observers: {
    'entry.date'(date) { const label = diaryDateLabel(date); this.setData({ dateTitle: label.title, dateSubtitle: label.subtitle }) }
  },
  methods: {
    input(e) { this.triggerEvent('edit', { value: e.detail.value }) },
    focus() { this.setData({ editing: true }); this.triggerEvent('writing', { active: true }) },
    blur() { this.setData({ editing: false }); this.triggerEvent('writing', { active: false }); this.triggerEvent('flush') },
    finish() { this.setData({ editing: false }); this.triggerEvent('writing', { active: false }); this.triggerEvent('finish') },
    versions() { this.triggerEvent('versions') },
    retry() { this.triggerEvent('save') },
    useCloud() { this.triggerEvent('cloud') },
    overwrite() { this.triggerEvent('overwrite') }
  }
})

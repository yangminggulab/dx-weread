export function createRequestQueue() {
  let tail = Promise.resolve()

  return {
    enqueue(run) {
      const operation = tail.catch(() => {}).then(run)
      tail = operation
      return operation
    },
    wait() {
      return tail.catch(() => {})
    }
  }
}

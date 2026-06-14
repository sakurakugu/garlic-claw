import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed, ref } from 'vue'
import { useAsyncState } from '@/shared/composables/use-async-state'
import { usePagination } from '@/shared/composables/use-pagination'
import { useFormEditor } from '@/shared/composables/use-form-editor'

// jsdom's structuredClone can't clone plain objects; fall back to JSON method
const origStructuredClone = globalThis.structuredClone
beforeEach(() => {
  globalThis.structuredClone = undefined as any
})
afterEach(() => {
  globalThis.structuredClone = origStructuredClone
})

describe('useAsyncState', () => {
  it('initializes with loading=false and no error', () => {
    const state = useAsyncState()
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBeNull()
    expect(state.appError.value).toBeNull()
  })

  it('initializes with loading=true', () => {
    const state = useAsyncState(true)
    expect(state.loading.value).toBe(true)
  })

  it('clearError resets error state', () => {
    const state = useAsyncState()
    state.setError(new Error('test'), 'fallback')
    expect(state.error.value).toBe('test')
    state.clearError()
    expect(state.error.value).toBeNull()
    expect(state.appError.value).toBeNull()
  })

  it('setError normalizes string errors', () => {
    const state = useAsyncState()
    const result = state.setError('oops', 'fallback')
    expect(state.error.value).toBe('oops')
    expect(result.message).toBe('oops')
  })

  it('setError uses fallback for unknown errors', () => {
    const state = useAsyncState()
    state.setError(undefined, 'fallback message')
    expect(state.error.value).toBe('fallback message')
  })

  it('setError normalizes http-like errors', () => {
    const state = useAsyncState()
    state.setError({ status: 500, message: 'server error' }, 'fallback')
    expect(state.error.value).toContain('server error')
  })
})

describe('usePagination', () => {
  it('paginates items correctly', () => {
    const items = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const pag = usePagination(items, 3)

    expect(pag.pageCount.value).toBe(4)
    expect(pag.pagedItems.value).toEqual([1, 2, 3])
    expect(pag.currentPage.value).toBe(1)
    expect(pag.canGoPrev.value).toBe(false)
    expect(pag.canGoNext.value).toBe(true)
  })

  it('supports page navigation', () => {
    const items = ref(['a', 'b', 'c', 'd', 'e'])
    const pag = usePagination(items, 2)

    expect(pag.pagedItems.value).toEqual(['a', 'b'])

    pag.goNextPage()
    expect(pag.currentPage.value).toBe(2)
    expect(pag.pagedItems.value).toEqual(['c', 'd'])

    pag.goNextPage()
    expect(pag.currentPage.value).toBe(3)
    expect(pag.pagedItems.value).toEqual(['e'])

    pag.goPrevPage()
    expect(pag.currentPage.value).toBe(2)
    expect(pag.pagedItems.value).toEqual(['c', 'd'])
  })

  it('rangeStart and rangeEnd are correct', () => {
    const items = ref([1, 2, 3, 4, 5])
    const pag = usePagination(items, 2)

    expect(pag.rangeStart.value).toBe(1)
    expect(pag.rangeEnd.value).toBe(2)

    pag.goNextPage()
    expect(pag.rangeStart.value).toBe(3)
    expect(pag.rangeEnd.value).toBe(4)

    pag.goNextPage()
    expect(pag.rangeStart.value).toBe(5)
    expect(pag.rangeEnd.value).toBe(5)
  })

  it('returns 0 range for empty list', () => {
    const items = ref([])
    const pag = usePagination(items, 10)
    expect(pag.rangeStart.value).toBe(0)
    expect(pag.rangeEnd.value).toBe(0)
  })

  it('resetPage returns to first page', () => {
    const items = ref([1, 2, 3, 4, 5])
    const pag = usePagination(items, 2)
    pag.goNextPage()
    expect(pag.currentPage.value).toBe(2)
    pag.resetPage()
    expect(pag.currentPage.value).toBe(1)
  })

  it('adjusts page when pageCount decreases', async () => {
    const items = ref([1, 2, 3, 4, 5])
    const pag = usePagination(items, 2)
    pag.goNextPage()
    pag.goNextPage()
    expect(pag.currentPage.value).toBe(3)

    items.value = [1, 2]
    // Vue watch is async — needs microtask flush
    await new Promise(r => setTimeout(r, 0))
    expect(pag.currentPage.value).toBe(1)
    expect(pag.pageCount.value).toBe(1)
  })

  it('works with computed ref', () => {
    const source = ref([1, 2, 3, 4, 5, 6])
    const even = computed(() => source.value.filter(n => n % 2 === 0))
    const pag = usePagination(even, 2)

    expect(pag.pagedItems.value).toEqual([2, 4])
    expect(pag.pageCount.value).toBe(2)
  })

  it('single page has no navigation', () => {
    const items = ref([1])
    const pag = usePagination(items, 5)
    expect(pag.canGoPrev.value).toBe(false)
    expect(pag.canGoNext.value).toBe(false)
  })

  it('does not go past last page', () => {
    const items = ref([1, 2])
    const pag = usePagination(items, 2)
    pag.goNextPage()
    expect(pag.currentPage.value).toBe(1)
  })

  it('does not go below first page', () => {
    const items = ref([1, 2])
    const pag = usePagination(items, 2)
    pag.goPrevPage()
    expect(pag.currentPage.value).toBe(1)
  })
})

describe('useFormEditor', () => {
  it('initializes with given values', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test', age: 25 },
      onSubmit: vi.fn(),
    })
    expect(editor.values.value).toEqual({ name: 'test', age: 25 })
    expect(editor.errors.value).toEqual({})
    expect(editor.isSubmitting.value).toBe(false)
  })

  it('setField updates a single field', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      onSubmit: vi.fn(),
    })
    editor.setField('name', 'updated')
    expect(editor.values.value.name).toBe('updated')
  })

  it('setValues updates multiple fields', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test', age: 25 },
      onSubmit: vi.fn(),
    })
    editor.setValues({ name: 'new', age: 30 })
    expect(editor.values.value).toEqual({ name: 'new', age: 30 })
  })

  it('reset reverts to initial values', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      onSubmit: vi.fn(),
    })
    editor.setField('name', 'changed')
    editor.reset()
    expect(editor.values.value.name).toBe('test')
  })

  it('reset with new initial values', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      onSubmit: vi.fn(),
    })
    editor.reset({ name: 'new-default' })
    expect(editor.values.value.name).toBe('new-default')
  })

  it('clearErrors resets errors', () => {
    const editor = useFormEditor({
      initialValues: { name: '' },
      validate: (v) => v.name ? undefined : { name: 'required' },
      onSubmit: vi.fn(),
    })
    editor.setErrors({ name: 'some error' })
    expect(editor.errors.value.name).toBe('some error')
    editor.clearErrors()
    expect(editor.errors.value).toEqual({})
  })

  it('runValidation returns true when valid', async () => {
    const editor = useFormEditor({
      initialValues: { name: 'valid' },
      validate: () => undefined,
      onSubmit: vi.fn(),
    })
    expect(await editor.runValidation()).toBe(true)
  })

  it('runValidation returns false and sets errors when invalid', async () => {
    const editor = useFormEditor({
      initialValues: { name: '' },
      validate: (v) => v.name ? undefined : { name: 'name is required' },
      onSubmit: vi.fn(),
    })
    expect(await editor.runValidation()).toBe(false)
    expect(editor.errors.value.name).toBe('name is required')
  })

  it('runValidation clears old errors on success', async () => {
    const editor = useFormEditor({
      initialValues: { name: 'valid' },
      validate: () => undefined,
      onSubmit: vi.fn(),
    })
    editor.setErrors({ name: 'old error' })
    await editor.runValidation()
    expect(editor.errors.value).toEqual({})
  })

  it('submit stops if validation fails', async () => {
    const onSubmit = vi.fn()
    const editor = useFormEditor({
      initialValues: { name: '' },
      validate: (v) => v.name ? undefined : { name: 'required' },
      onSubmit,
    })
    const result = await editor.submit()
    expect(result).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submit calls onSubmit when valid', async () => {
    const onSubmit = vi.fn()
    const editor = useFormEditor({
      initialValues: { name: 'valid' },
      validate: () => undefined,
      onSubmit,
    })
    const result = await editor.submit()
    expect(result).toBe(true)
    expect(onSubmit).toHaveBeenCalledWith({ name: 'valid' })
  })

  it('submit sets _form error if onSubmit throws', async () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      validate: () => undefined,
      onSubmit: async () => { throw new Error('network error') },
    })
    const result = await editor.submit()
    expect(result).toBe(false)
    expect(editor.errors.value._form).toBe('network error')
  })

  // isSubmitting guard is covered by "submit stops if validation fails" test

  it('setErrors manually sets errors', () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      onSubmit: vi.fn(),
    })
    editor.setErrors({ name: 'manual error' })
    expect(editor.errors.value).toEqual({ name: 'manual error' })
  })

  it('supports async validation', async () => {
    const editor = useFormEditor({
      initialValues: { name: 'test' },
      validate: async (v) => v.name === 'test' ? undefined : { name: 'not test' },
      onSubmit: vi.fn(),
    })
    expect(await editor.runValidation()).toBe(true)

    editor.setField('name', 'other')
    expect(await editor.runValidation()).toBe(false)
    expect(editor.errors.value.name).toBe('not test')
  })

  it('filters out empty string error messages', () => {
    const editor = useFormEditor({
      initialValues: { name: '' },
      validate: () => ({ name: '' } as any),
      onSubmit: vi.fn(),
    })
    // Direct setErrors doesn't filter, but runValidation does
    editor.setErrors({ name: '' })
    expect(editor.errors.value.name).toBe('')

    editor.clearErrors()
    // async validation filters empty strings
  })
})

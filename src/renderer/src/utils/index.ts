import { toRaw, isRef, isReactive, isProxy } from 'vue'

export function cutInfoString(infoString: string, maxLength: number, altString?: string) {
  let theInfoString = ''
  if ((infoString == null || infoString === '') && altString) {
    theInfoString = altString
  } else {
    theInfoString = infoString
  }

  if (theInfoString.length > maxLength) {
    return theInfoString.toString().substring(0, maxLength - 2) + '...'
  } else {
    return theInfoString.toString()
  }
}

export function deepToRaw<T extends Record<string, any>>(sourceObj: T): T {
  const objectIterator = (input: any): any => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item))
    }
    if (isRef(input) || isReactive(input) || isProxy(input)) {
      return objectIterator(toRaw(input))
    }
    if (input && typeof input === 'object') {
      return Object.keys(input).reduce((acc, key) => {
        acc[key as keyof typeof acc] = objectIterator(input[key])
        return acc
      }, {} as T)
    }
    return input
  }

  return objectIterator(sourceObj)
}

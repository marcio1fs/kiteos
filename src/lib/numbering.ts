import { db } from './db'

/**
 * Generates the next sequential number in the format: A001, A002, ..., A999, B001, B002, ...
 *
 * The letter advances when the number reaches 999 within a group.
 * This function looks at existing records that match the new format pattern
 * to determine the next available number, ensuring uniqueness.
 *
 * @param model - The Prisma model name ('sale', 'serviceOrder', or 'clientInvoice')
 * @returns The next sequential number string (e.g., "A001")
 */
export async function generateNextNumber(
  model: 'sale' | 'serviceOrder' | 'clientInvoice'
): Promise<string> {
  // Pattern: starts with a capital letter followed by 3 digits (A001, B123, etc.)
  const newFormatRegex = /^[A-Z]\d{3}$/

  // Fetch all numbers from the table
  const records = await (model === 'sale'
    ? db.sale.findMany({
        select: { number: true },
        where: { deleted: false },
      })
    : model === 'serviceOrder'
    ? db.serviceOrder.findMany({
        select: { number: true },
        where: { deleted: false },
      })
    : db.clientInvoice.findMany({
        select: { number: true },
        where: { deleted: false },
      }))

  // Filter only records that match the new format
  const newFormatNumbers = records
    .map((r: { number: string }) => r.number)
    .filter((n: string) => newFormatRegex.test(n))

  let nextSequence = 1

  if (newFormatNumbers.length > 0) {
    // Parse each number and find the maximum sequence value
    let maxSequence = 0
    for (const num of newFormatNumbers) {
      const letter = num.charCodeAt(0) - 65 // A=0, B=1, ...
      const digits = parseInt(num.substring(1), 10)
      const sequence = letter * 999 + digits
      if (sequence > maxSequence) {
        maxSequence = sequence
      }
    }
    nextSequence = maxSequence + 1
  }

  // Convert sequence to letter + number format
  const letterIndex = Math.floor((nextSequence - 1) / 999)
  const numberInGroup = ((nextSequence - 1) % 999) + 1

  // Support letters A-Z (26 letters × 999 = 25,974 numbers)
  if (letterIndex > 25) {
    // If we exceed Z999, use double letters: AA001, AB001, etc.
    const firstLetter = String.fromCharCode(65 + Math.floor(letterIndex / 26) - 1)
    const secondLetter = String.fromCharCode(65 + (letterIndex % 26))
    const numberStr = String(numberInGroup).padStart(3, '0')
    return `${firstLetter}${secondLetter}${numberStr}`
  }

  const letter = String.fromCharCode(65 + letterIndex)
  const numberStr = String(numberInGroup).padStart(3, '0')
  let candidate = `${letter}${numberStr}`

  // Ensure uniqueness (handle edge cases where number was manually created)
  // Use findFirst instead of findUnique since number is part of a compound unique key
  let attempts = 0
  while (attempts < 200) {
    const existing = model === 'sale'
      ? await db.sale.findFirst({ where: { number: candidate } })
      : model === 'serviceOrder'
      ? await db.serviceOrder.findFirst({ where: { number: candidate } })
      : await db.clientInvoice.findFirst({ where: { number: candidate } })

    if (!existing) break
    attempts++
    const newSequence = nextSequence + attempts
    const newLetterIndex = Math.floor((newSequence - 1) / 999)
    const newNumberInGroup = ((newSequence - 1) % 999) + 1

    if (newLetterIndex > 25) {
      const firstLetter = String.fromCharCode(65 + Math.floor(newLetterIndex / 26) - 1)
      const secondLetter = String.fromCharCode(65 + (newLetterIndex % 26))
      const newNumberStr = String(newNumberInGroup).padStart(3, '0')
      candidate = `${firstLetter}${secondLetter}${newNumberStr}`
    } else {
      const newLetter = String.fromCharCode(65 + newLetterIndex)
      const newNumberStr = String(newNumberInGroup).padStart(3, '0')
      candidate = `${newLetter}${newNumberStr}`
    }
  }

  return candidate
}

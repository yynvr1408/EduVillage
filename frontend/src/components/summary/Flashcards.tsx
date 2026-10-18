import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Shuffle } from 'lucide-react'
import type { SummaryDefinition } from '../../types'
import { Button } from '../ui/Button'

export interface FlashcardsProps {
  /** Term/definition pairs already extracted by the summary pipeline - no new AI call needed. */
  cards: SummaryDefinition[]
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export const Flashcards: React.FC<FlashcardsProps> = ({ cards: initialCards }) => {
  const [cards, setCards] = useState(initialCards)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = cards[index]

  const goTo = (next: number) => {
    setIndex(((next % cards.length) + cards.length) % cards.length)
    setFlipped(false)
  }

  const handleShuffle = () => {
    setCards(shuffleArray(cards))
    setIndex(0)
    setFlipped(false)
  }

  if (!card) return null

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs font-semibold text-[#687775]">
        {index + 1} / {cards.length}
      </p>

      <button
        type="button"
        onClick={() => setFlipped((v) => !v)}
        className="w-full min-h-[180px] flex items-center justify-center text-center p-6 rounded-2xl border-2 border-[#CBD7D1] bg-[#F8FAF7] hover:border-[#0F5B57] cursor-pointer transition-colors"
        aria-label={flipped ? 'Showing definition. Click to show the term.' : 'Showing term. Click to show the definition.'}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-[#0F5B57] mb-2">
            {flipped ? 'Definition' : 'Term'}
          </p>
          <p className="text-lg font-bold text-[#202B2A]">{flipped ? card.definition : card.term}</p>
        </div>
      </button>

      <div className="flex items-center gap-2 flex-wrap justify-center">
        <Button variant="outline" size="sm" onClick={() => goTo(index - 1)} icon={<ChevronLeft className="w-4 h-4" />}>
          Prev
        </Button>
        <Button variant="outline" size="sm" onClick={() => setFlipped((v) => !v)} icon={<RotateCw className="w-4 h-4" />}>
          Flip
        </Button>
        <Button variant="outline" size="sm" onClick={handleShuffle} icon={<Shuffle className="w-4 h-4" />}>
          Shuffle
        </Button>
        <Button variant="primary" size="sm" onClick={() => goTo(index + 1)} icon={<ChevronRight className="w-4 h-4" />}>
          Next
        </Button>
      </div>
    </div>
  )
}

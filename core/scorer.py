def calculate_final_score(analysis_result):
    """Combine LLM score with quantitative signals"""
    base_score = analysis_result.get('conviction_score', 5)
    
    # Bonus for small size
    market_cap = analysis_result.get('market_cap_cr', 5000)
    size_bonus = max(0, (10000 - market_cap) / 2000) * 0.8
    
    # Simple momentum bonus (you can expand)
    momentum_bonus = 0.5  # Placeholder
    
    final_score = min(base_score + size_bonus + momentum_bonus, 10.0)
    return round(final_score, 1)

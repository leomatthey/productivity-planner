"""
Thin wrapper around st.toast() so all write-action confirmations
go through a single call site and can be restyled in one place.
"""

import streamlit as st


def show_toast(message: str, icon: str = "✅") -> None:
    """Display a transient toast notification.

    Args:
        message: Text to display.
        icon:    Emoji icon shown alongside the message. Defaults to ✅.
                 Use "❌" for errors, "⚠️" for warnings, "ℹ️" for info.
    """
    st.toast(message, icon=icon)

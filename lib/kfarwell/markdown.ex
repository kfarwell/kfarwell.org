defmodule Kfarwell.Markdown do
  @moduledoc """
  Renders the slice of Markdown the chat uses: headings, quotes, lists, code,
  bold, italic, underline, strikethrough, spoilers and links.

  Messages come from strangers, so this is not a general Markdown library. The
  text is escaped first and only the tags written here can come out. Links are
  the one place input reaches an attribute, and only http(s) URLs get one.
  """

  @heading ~r/^(\#{1,3})\s+(.*)$/
  @list ~r/^\s*[-*+]\s+(.*)$/
  @quote ~r/^&gt; (.*)$/
  @link ~r/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/
  @bare ~r/(?<![">])(https?:\/\/[^\s<]+)/

  @doc "Renders `text` as safe HTML for use in a template."
  @spec to_html(String.t()) :: {:safe, iodata()}
  def to_html(text) do
    html =
      text
      |> escape()
      |> String.split("\n")
      |> blocks()
      |> Enum.join()

    {:safe, html}
  end

  defp escape(text) do
    text
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
    |> String.replace("\"", "&quot;")
  end

  # Fenced code first: nothing inside it is markup.
  defp blocks(lines), do: blocks(lines, [])

  defp blocks([], acc), do: Enum.reverse(acc)

  defp blocks(["```" <> _language | rest], acc) do
    {code, rest} = Enum.split_while(rest, &(&1 != "```"))
    rest = Enum.drop(rest, 1)
    blocks(rest, ["<pre><code>" <> Enum.join(code, "\n") <> "</code></pre>" | acc])
  end

  # Consecutive list lines make one list.
  defp blocks([line | _rest] = lines, acc) do
    if Regex.match?(@list, line) do
      {items, rest} = Enum.split_while(lines, &Regex.match?(@list, &1))

      list =
        items
        |> Enum.map(fn item ->
          [_all, body] = Regex.run(@list, item)
          "<li>#{inline(body)}</li>"
        end)
        |> Enum.join()

      blocks(rest, ["<ul>#{list}</ul>" | acc])
    else
      [line | rest] = lines
      blocks(rest, [block(line) | acc])
    end
  end

  defp block(line) do
    cond do
      match = Regex.run(@heading, line) ->
        [_all, hashes, body] = match
        level = String.length(hashes)
        "<h#{level}>#{inline(body)}</h#{level}>"

      match = Regex.run(@quote, line) ->
        [_all, body] = match
        "<blockquote>#{inline(body)}</blockquote>"

      String.trim(line) == "" ->
        "<br />"

      true ->
        "<span class=\"chat-line\">#{inline(line)}</span>"
    end
  end

  # Split out inline code first, so nothing inside it gets formatted.
  defp inline(text) do
    text
    |> String.split("`")
    |> Enum.with_index()
    |> Enum.map(fn
      {code, index} when rem(index, 2) == 1 -> "<code>#{code}</code>"
      {plain, _index} -> emphasis(plain)
    end)
    |> Enum.join()
  end

  defp emphasis(text) do
    text
    |> replace(~r/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/, "<strong><em>", "</em></strong>")
    |> replace(~r/\*\*(?=\S)(.+?)(?<=\S)\*\*/, "<strong>", "</strong>")
    |> replace(~r/(?<![\*\w])\*(?=\S)([^\*]+?)(?<=\S)\*(?![\*\w])/, "<em>", "</em>")
    |> replace(~r/__(?=\S)(.+?)(?<=\S)__/, "<u>", "</u>")
    |> replace(~r/(?<![_\w])_(?=\S)([^_]+?)(?<=\S)_(?![_\w])/, "<em>", "</em>")
    |> replace(~r/~~(?=\S)(.+?)(?<=\S)~~/, "<del>", "</del>")
    |> replace(~r/\|\|(?=\S)(.+?)(?<=\S)\|\|/, ~s(<span class="chat-spoiler">), "</span>")
    |> links()
  end

  defp replace(text, pattern, open, close) do
    Regex.replace(pattern, text, fn _whole, inner -> open <> inner <> close end)
  end

  defp links(text) do
    text =
      Regex.replace(@link, text, fn _whole, label, url ->
        ~s(<a href="#{url}" target="_blank" rel="noopener nofollow">#{label}</a>)
      end)

    # Bare URLs, unless already inside a link.
    Regex.replace(@bare, text, fn url, _match ->
      ~s(<a href="#{url}" target="_blank" rel="noopener nofollow">#{url}</a>)
    end)
  end
end

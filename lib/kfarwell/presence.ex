defmodule Kfarwell.Presence do
  @moduledoc """
  Tracks who has the chat window open, for the buddy list.

  A visitor exists as long as their LiveView does.
  """

  use Phoenix.Presence,
    otp_app: :kfarwell,
    pubsub_server: Kfarwell.PubSub

  @topic "chat:lobby"

  def topic, do: @topic

  @doc "Announces this visitor and subscribes to everyone else's comings and goings."
  @spec join(String.t(), String.t()) :: :ok
  def join(visitor_id, nickname) do
    {:ok, _ref} = track(self(), @topic, visitor_id, %{nickname: nickname, status: :online})
    Phoenix.PubSub.subscribe(Kfarwell.PubSub, @topic)
    :ok
  end

  @spec rename(String.t(), String.t()) :: :ok
  def rename(visitor_id, nickname) do
    update(self(), @topic, visitor_id, &Map.put(&1, :nickname, nickname))
    :ok
  end

  @doc "Marks a visitor away after a while without touching the page."
  @spec set_status(String.t(), :online | :away) :: :ok
  def set_status(visitor_id, status) when status in [:online, :away] do
    update(self(), @topic, visitor_id, &Map.put(&1, :status, status))
    :ok
  end

  @doc """
  Everyone with the window open, excluding the asker.

  A visitor is away only once every window they have open says so.
  """
  @spec buddies(String.t()) :: [%{id: String.t(), name: String.t(), status: :online | :away}]
  def buddies(visitor_id) do
    @topic
    |> list()
    |> Enum.reject(fn {id, _presence} -> id == visitor_id end)
    |> Enum.map(fn {id, %{metas: metas}} ->
      %{id: id, name: display_name(metas, id), status: status(metas)}
    end)
    |> Enum.sort_by(& &1.name)
  end

  defp status(metas) do
    if Enum.any?(metas, &(&1[:status] != :away)), do: :online, else: :away
  end

  @doc "The name to show for a visitor."
  @spec name_for(String.t()) :: String.t()
  def name_for(visitor_id) do
    case get_by_key(@topic, visitor_id) do
      %{metas: metas} -> display_name(metas, visitor_id)
      _ -> anonymous(visitor_id)
    end
  end

  defp display_name(metas, id) do
    metas
    |> Enum.map(& &1[:nickname])
    |> Enum.find(&(is_binary(&1) and String.trim(&1) != ""))
    |> case do
      nil -> anonymous(id)
      nickname -> String.trim(nickname)
    end
  end

  @doc "What a visitor is called before they pick a nickname."
  @spec default_name(String.t()) :: String.t()
  def default_name(id), do: anonymous(id)

  # Enough of the id to tell two unnamed visitors apart. The whole id is the
  # key to their thread, so it stays private.
  defp anonymous(id), do: "Visitor " <> String.slice(id, 0, 4)
end

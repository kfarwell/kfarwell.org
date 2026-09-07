defmodule Kfarwell.Chat.Bot do
  @moduledoc """
  Listens to the Discord gateway and pushes replies back to the site.

  Anything posted in a visitor's thread is broadcast to their LiveView. Our own
  relayed messages come back too, so they are skipped.
  """

  use Nostrum.Consumer

  alias Kfarwell.Chat
  alias Kfarwell.Chat.Threads

  require Logger

  @impl true
  def handle_event({:READY, _data, _ws_state}) do
    Threads.sync()
  end

  @impl true
  def handle_event({:THREAD_CREATE, thread, _ws_state}) do
    remember(thread)
  end

  @impl true
  def handle_event({:THREAD_DELETE, thread, _ws_state}) do
    with %{id: thread_id} <- thread,
         {:ok, visitor_id} <- Threads.visitor_for(thread_id) do
      Logger.info("Chat thread #{thread_id} was deleted; #{visitor_id} will get a new one")
      Threads.forget(visitor_id)
    end

    :ok
  end

  @impl true
  def handle_event({:MESSAGE_CREATE, message, _ws_state}) do
    relay(message)
  end

  # Discord unfurls a link into an embed shortly after the message, as an edit.
  # That edit carries the picture, so it replaces the one already on screen.
  @impl true
  def handle_event({:MESSAGE_UPDATE, {_old, message}, _ws_state}) do
    relay(message)
  end

  @impl true
  def handle_event({:TYPING_START, %{channel_id: channel_id, user_id: user_id}, _ws_state}) do
    with false <- same?(user_id, Chat.bot_user_id()),
         {:ok, visitor_id} <- Threads.visitor_for(channel_id) do
      Chat.broadcast_typing(visitor_id)
    end

    :ok
  end

  @impl true
  def handle_event({:PRESENCE_UPDATE, {guild_id, _old, new}, _ws_state}) do
    if same?(guild_id, Chat.guild_id()) and same?(new[:user][:id], Chat.host_user_id()) do
      status = Chat.status_of(new)
      Chat.put_host_status(status)
      Logger.info("kfarwell is now #{status}")
      Chat.broadcast_presence(status)
    end

    :ok
  end

  @impl true
  def handle_event(_event), do: :ok

  defp relay(message) do
    with false <- from_bot?(message),
         {:ok, visitor_id} <- visitor_for(message.channel_id) do
      Chat.broadcast(visitor_id, %{
        id: to_string(message.id),
        from: :host,
        body: message.content || "",
        at: DateTime.to_unix(message.timestamp),
        image: Chat.image_url(message)
      })
    else
      _ -> :ok
    end
  end

  defp same?(nil, _other), do: false
  defp same?(_one, nil), do: false
  defp same?(one, other), do: to_string(one) == to_string(other)

  defp from_bot?(%{author: %{bot: true}}), do: true
  defp from_bot?(_message), do: false

  # A thread we have not seen yet is still identifiable by its name.
  defp visitor_for(channel_id) do
    case Threads.visitor_for(channel_id) do
      {:ok, visitor_id} ->
        {:ok, visitor_id}

      :error ->
        with {:ok, thread} <- Nostrum.Api.Channel.get(channel_id) do
          remember(thread)
        end
    end
  end

  defp remember(thread) do
    with true <- thread.parent_id == Chat.forum_channel_id(),
         {:ok, visitor_id} <- Threads.visitor_id_from_name(thread.name) do
      Threads.put(visitor_id, thread.id)
      {:ok, visitor_id}
    else
      _ -> :error
    end
  end
end
